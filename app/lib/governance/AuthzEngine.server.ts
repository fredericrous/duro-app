import { Context, Effect, Data, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import * as SqlError from "@effect/sql/SqlError"
import { MigrationsRan } from "~/lib/db/client.server"
import { type AccessCheck, type AccessDecision } from "./types"

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class AuthzError extends Data.TaggedError("AuthzError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

// ---------------------------------------------------------------------------
// Service definition
// ---------------------------------------------------------------------------

export class AuthzEngine extends Context.Tag("AuthzEngine")<
  AuthzEngine,
  {
    readonly checkAccess: (check: AccessCheck) => Effect.Effect<AccessDecision, AuthzError>
    readonly checkBulk: (checks: readonly AccessCheck[]) => Effect.Effect<readonly AccessDecision[], AuthzError>
  }
>() {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const deny = (reason: string): AccessDecision => ({
  allow: false,
  matchedGrantIds: [],
  reasons: [reason],
})

const withErr = <A>(effect: Effect.Effect<A, SqlError.SqlError>, message: string): Effect.Effect<A, AuthzError> =>
  effect.pipe(Effect.mapError((cause) => new AuthzError({ message, cause })))

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

interface ResolvedSubject {
  readonly principalId: string
  readonly groupIds: readonly string[]
  readonly allIds: readonly string[]
}

/**
 * Resolve a subject (OIDC sub) to its principal + single-hop groups.
 * null = unknown or disabled principal (the caller denies).
 * Factored out so checkBulk resolves each unique subject exactly once.
 */
const resolveSubject = (sql: SqlClient.SqlClient, subject: string): Effect.Effect<ResolvedSubject | null, AuthzError> =>
  Effect.gen(function* () {
    const principals = yield* withErr(
      sql<{ id: string }>`SELECT id FROM principals WHERE external_id = ${subject} AND enabled = TRUE`,
      "Failed to resolve principal",
    )
    if (principals.length === 0) return null
    const principalId = principals[0].id

    const memberships = yield* withErr(
      sql<{ groupId: string }>`SELECT group_id FROM group_memberships WHERE member_id = ${principalId}`,
      "Failed to resolve groups",
    )
    const groupIds = memberships.map((r) => r.groupId)
    return { principalId, groupIds, allIds: [principalId, ...groupIds] }
  })

const checkAccessImpl = (sql: SqlClient.SqlClient, check: AccessCheck, resolved: ResolvedSubject) =>
  Effect.gen(function* () {
    const startMs = Date.now()
    const { principalId, groupIds, allIds } = resolved

    // 3. Resolve application
    const apps = yield* withErr(
      sql`SELECT id FROM applications WHERE slug = ${check.application} AND enabled = TRUE`,
      "Failed to resolve application",
    )
    if (apps.length === 0) {
      return deny("Application not found or disabled")
    }
    const appId = (apps[0] as any).id as string

    // 4. Get all effective entitlements via UNION query
    const effectiveEntitlements = yield* withErr(
      sql`
        SELECT g.id AS grant_id, e.slug, g.resource_id FROM grants g
        JOIN entitlements e ON e.id = g.entitlement_id
        WHERE g.principal_id = ANY(${allIds}) AND e.application_id = ${appId}
          AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > NOW())
          AND g.entitlement_id IS NOT NULL
        UNION
        SELECT g.id AS grant_id, e.slug, g.resource_id FROM grants g
        JOIN role_entitlements re ON re.role_id = g.role_id
        JOIN entitlements e ON e.id = re.entitlement_id
        WHERE g.principal_id = ANY(${allIds}) AND e.application_id = ${appId}
          AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > NOW())
          AND g.role_id IS NOT NULL
      `,
      "Failed to query effective entitlements",
    )

    // 5. Filter by action (entitlement slug)
    const matched = effectiveEntitlements.filter((r: any) => r.slug === check.action)

    // 6. Resource scoping
    let finalMatches = matched
    if (check.resourceId) {
      finalMatches = matched.filter((r: any) => {
        if (r.resourceId === null) return true // app-wide grant
        if (r.resourceId === check.resourceId) return true // exact match
        return false // ancestor match would require path lookup
      })

      // If no exact matches, try ancestor matching via resources.path
      if (finalMatches.length === 0 && matched.some((r: any) => r.resourceId !== null)) {
        // Get the resource's path
        const resources = yield* withErr(
          sql`SELECT path FROM resources WHERE id = ${check.resourceId}`,
          "Failed to resolve resource path",
        )
        if (resources.length > 0 && (resources[0] as any).path) {
          const resourcePath = (resources[0] as any).path as string
          // Find grants whose resource has a path that is a prefix of this resource's path
          const ancestorGrants = yield* withErr(
            sql`
              SELECT g.id AS grant_id FROM grants g
              JOIN resources r ON r.id = g.resource_id
              WHERE g.id = ANY(${matched.filter((r: any) => r.resourceId !== null).map((r: any) => r.grantId)})
                AND starts_with(${resourcePath}, r.path || '/')
            `,
            "Failed to check ancestor grants",
          )
          const ancestorGrantIds = new Set(ancestorGrants.map((r: any) => r.grantId))
          // Include app-wide grants + ancestor grants
          finalMatches = matched.filter((r: any) => r.resourceId === null || ancestorGrantIds.has(r.grantId))
        }
      }
    }

    const matchedGrantIds = [...new Set(finalMatches.map((r: any) => r.grantId as string))]
    const evaluationMs = Date.now() - startMs

    if (matchedGrantIds.length > 0) {
      return {
        allow: true,
        matchedGrantIds,
        reasons: [`Matched ${matchedGrantIds.length} grant(s) for action '${check.action}'`],
        diagnostics: {
          principalId,
          groupIds,
          candidateGrantCount: effectiveEntitlements.length,
          evaluationMs,
        },
      } satisfies AccessDecision
    }

    return {
      allow: false,
      matchedGrantIds: [],
      reasons: [`No matching grants for action '${check.action}' on application '${check.application}'`],
      diagnostics: {
        principalId,
        groupIds,
        candidateGrantCount: effectiveEntitlements.length,
        evaluationMs,
      },
    } satisfies AccessDecision
  })

const checkAccessEntry = (sql: SqlClient.SqlClient, check: AccessCheck) =>
  Effect.gen(function* () {
    const resolved = yield* resolveSubject(sql, check.subject)
    if (resolved === null) return deny("Principal not found or disabled")
    return yield* checkAccessImpl(sql, check, resolved)
  })

// ---------------------------------------------------------------------------
// Bulk implementation — resolve each unique subject once, share the result
// ---------------------------------------------------------------------------

const checkBulkImpl = (sql: SqlClient.SqlClient, checks: readonly AccessCheck[]) =>
  Effect.gen(function* () {
    const uniqueSubjects = [...new Set(checks.map((c) => c.subject))]
    const resolutions = yield* Effect.forEach(
      uniqueSubjects,
      (subject) => Effect.map(resolveSubject(sql, subject), (r) => [subject, r] as const),
      { concurrency: 4 },
    )
    const subjectCache = new Map(resolutions)

    return yield* Effect.forEach(checks, (check) => {
      const resolved = subjectCache.get(check.subject)
      if (resolved == null) return Effect.succeed(deny("Principal not found or disabled"))
      return checkAccessImpl(sql, check, resolved)
    })
  })

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export const AuthzEngineLive = Layer.effect(
  AuthzEngine,
  Effect.gen(function* () {
    yield* MigrationsRan
    const sql = yield* SqlClient.SqlClient

    return {
      checkAccess: (check) => checkAccessEntry(sql, check),
      checkBulk: (checks) => checkBulkImpl(sql, checks),
    }
  }),
)
