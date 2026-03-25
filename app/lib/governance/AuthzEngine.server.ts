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

const withErr = <A>(
  effect: Effect.Effect<A, SqlError.SqlError>,
  message: string,
): Effect.Effect<A, AuthzError> =>
  effect.pipe(
    Effect.mapError((cause) => new AuthzError({ message, cause })),
  )

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const checkAccessImpl = (sql: SqlClient.SqlClient, check: AccessCheck) =>
  Effect.gen(function* () {
    const startMs = Date.now()

    // 1. Resolve principal
    const principals = yield* withErr(
      sql`SELECT id FROM principals WHERE external_id = ${check.subject} AND enabled = TRUE`,
      "Failed to resolve principal",
    )
    if (principals.length === 0) {
      return deny("Principal not found or disabled")
    }
    const principalId = (principals[0] as any).id as string

    // 2. Resolve groups (single-hop)
    const memberships = yield* withErr(
      sql`SELECT group_id FROM group_memberships WHERE member_id = ${principalId}`,
      "Failed to resolve groups",
    )
    const groupIds = memberships.map((r: any) => r.groupId as string)
    const allIds = [principalId, ...groupIds]

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
                AND ${resourcePath} LIKE r.path || '/%'
            `,
            "Failed to check ancestor grants",
          )
          const ancestorGrantIds = new Set(ancestorGrants.map((r: any) => r.grantId))
          // Include app-wide grants + ancestor grants
          finalMatches = matched.filter(
            (r: any) => r.resourceId === null || ancestorGrantIds.has(r.grantId),
          )
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
      reasons: [
        `No matching grants for action '${check.action}' on application '${check.application}'`,
      ],
      diagnostics: {
        principalId,
        groupIds,
        candidateGrantCount: effectiveEntitlements.length,
        evaluationMs,
      },
    } satisfies AccessDecision
  })

// ---------------------------------------------------------------------------
// Bulk implementation — deduplicate subjects
// ---------------------------------------------------------------------------

const checkBulkImpl = (sql: SqlClient.SqlClient, checks: readonly AccessCheck[]) =>
  Effect.gen(function* () {
    // Deduplicate subjects and pre-resolve principal + groups once per unique subject
    const subjectCache = new Map<
      string,
      { principalId: string; groupIds: string[]; allIds: string[] } | null
    >()

    const uniqueSubjects = [...new Set(checks.map((c) => c.subject))]

    for (const subject of uniqueSubjects) {
      const principals = yield* withErr(
        sql`SELECT id FROM principals WHERE external_id = ${subject} AND enabled = TRUE`,
        "Failed to resolve principal",
      )
      if (principals.length === 0) {
        subjectCache.set(subject, null)
        continue
      }
      const principalId = (principals[0] as any).id as string

      const memberships = yield* withErr(
        sql`SELECT group_id FROM group_memberships WHERE member_id = ${principalId}`,
        "Failed to resolve groups",
      )
      const groupIds = memberships.map((r: any) => r.groupId as string)
      subjectCache.set(subject, {
        principalId,
        groupIds,
        allIds: [principalId, ...groupIds],
      })
    }

    // Evaluate each check, reusing cached principal resolution
    const results: AccessDecision[] = []
    for (const check of checks) {
      const cached = subjectCache.get(check.subject)
      if (cached === null || cached === undefined) {
        results.push(deny("Principal not found or disabled"))
        continue
      }
      // Use the full checkAccessImpl for each check (it will re-resolve the principal
      // but the SQL round-trip is cheap compared to the entitlement query).
      // For a more optimized version we could inline the logic, but correctness first.
      const decision = yield* checkAccessImpl(sql, check)
      results.push(decision)
    }

    return results as readonly AccessDecision[]
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
      checkAccess: (check) => checkAccessImpl(sql, check),
      checkBulk: (checks) => checkBulkImpl(sql, checks),
    }
  }),
)
