import { Context, Effect, Data, Layer, ParseResult } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import * as SqlError from "@effect/sql/SqlError"
import { MigrationsRan } from "~/lib/db/client.server"
import { decodeGrant, decodeGrantExportRow, type Grant, type GrantExportRow } from "./types"

export class GrantRepoError extends Data.TaggedError("GrantRepoError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

const withErr = <A>(effect: Effect.Effect<A, SqlError.SqlError | ParseResult.ParseError>, message: string) =>
  effect.pipe(Effect.mapError((e) => new GrantRepoError({ message, cause: e })))

export class GrantRepo extends Context.Tag("GrantRepo")<
  GrantRepo,
  {
    readonly grantRole: (input: {
      principalId: string
      roleId: string
      resourceId?: string
      grantedBy: string
      reason?: string
      expiresAt?: string
    }) => Effect.Effect<Grant, GrantRepoError>
    readonly grantEntitlement: (input: {
      principalId: string
      entitlementId: string
      resourceId?: string
      grantedBy: string
      reason?: string
      expiresAt?: string
    }) => Effect.Effect<Grant, GrantRepoError>
    readonly revoke: (id: string, revokedBy: string | null) => Effect.Effect<void, GrantRepoError>
    readonly findById: (id: string) => Effect.Effect<Grant | null, GrantRepoError>
    readonly findActiveForPrincipal: (principalId: string) => Effect.Effect<Grant[], GrantRepoError>
    readonly findActiveForPrincipalAndApp: (
      principalId: string,
      applicationId: string,
    ) => Effect.Effect<Grant[], GrantRepoError>
    readonly findActiveForApp: (applicationId: string) => Effect.Effect<Grant[], GrantRepoError>
    /**
     * Safety check for LDAP deprovisioning: is there ANY other active, non-expired
     * grant for the same principal whose role maps to the same external group on
     * the same connected system?
     */
    readonly hasOtherActiveMappingTo: (params: {
      excludeGrantId: string
      principalId: string
      connectedSystemId: string
      externalRoleIdentifier: string
    }) => Effect.Effect<boolean, GrantRepoError>
    readonly findExpired: () => Effect.Effect<Grant[], GrantRepoError>
    /**
     * Full "who has access to what" export for machine consumers (CMDB/EA):
     * every ACTIVE grant joined to its grantee, application, role XOR
     * entitlement, optional resource and granting principal — one query, no
     * N+1. Group grantees carry their single-hop members pre-aggregated so
     * the consumer can compute person→application edges without extra calls.
     */
    readonly exportActive: (filter?: { applicationSlug?: string }) => Effect.Effect<GrantExportRow[], GrantRepoError>
  }
>() {}

export const GrantRepoLive = Layer.effect(
  GrantRepo,
  Effect.gen(function* () {
    yield* MigrationsRan
    const sql = yield* SqlClient.SqlClient

    return {
      grantRole: (input) =>
        withErr(
          sql`INSERT INTO grants (principal_id, role_id, resource_id, granted_by, reason, expires_at)
              VALUES (${input.principalId}, ${input.roleId}, ${input.resourceId ?? null}, ${input.grantedBy}, ${input.reason ?? null}, ${input.expiresAt ?? null})
              RETURNING *`.pipe(Effect.flatMap((rows) => decodeGrant(rows[0]))),
          "Failed to grant role",
        ),

      grantEntitlement: (input) =>
        withErr(
          sql`INSERT INTO grants (principal_id, entitlement_id, resource_id, granted_by, reason, expires_at)
              VALUES (${input.principalId}, ${input.entitlementId}, ${input.resourceId ?? null}, ${input.grantedBy}, ${input.reason ?? null}, ${input.expiresAt ?? null})
              RETURNING *`.pipe(Effect.flatMap((rows) => decodeGrant(rows[0]))),
          "Failed to grant entitlement",
        ),

      revoke: (id, revokedBy) =>
        withErr(
          sql`UPDATE grants SET revoked_at = NOW(), revoked_by = ${revokedBy} WHERE id = ${id}`.pipe(Effect.asVoid),
          "Failed to revoke grant",
        ),

      findById: (id) =>
        withErr(
          sql`SELECT * FROM grants WHERE id = ${id}`.pipe(
            Effect.flatMap((rows) => (rows.length > 0 ? decodeGrant(rows[0]) : Effect.succeed(null))),
          ),
          "Failed to find grant",
        ),

      findActiveForPrincipal: (principalId) =>
        withErr(
          sql`SELECT * FROM grants
              WHERE principal_id = ${principalId}
                AND revoked_at IS NULL
                AND (expires_at IS NULL OR expires_at > NOW())`.pipe(
            Effect.flatMap((rows) => Effect.forEach(rows, decodeGrant)),
          ),
          "Failed to find active grants for principal",
        ),

      findActiveForPrincipalAndApp: (principalId, applicationId) =>
        withErr(
          sql`SELECT * FROM grants
              WHERE principal_id = ${principalId}
                AND revoked_at IS NULL
                AND (expires_at IS NULL OR expires_at > NOW())
                AND (
                  role_id IN (SELECT id FROM roles WHERE application_id = ${applicationId})
                  OR entitlement_id IN (SELECT id FROM entitlements WHERE application_id = ${applicationId})
                )`.pipe(Effect.flatMap((rows) => Effect.forEach(rows, decodeGrant))),
          "Failed to find active grants for principal and app",
        ),

      findActiveForApp: (applicationId) =>
        withErr(
          sql`SELECT * FROM grants
              WHERE revoked_at IS NULL
                AND (expires_at IS NULL OR expires_at > NOW())
                AND (
                  role_id IN (SELECT id FROM roles WHERE application_id = ${applicationId})
                  OR entitlement_id IN (SELECT id FROM entitlements WHERE application_id = ${applicationId})
                )`.pipe(Effect.flatMap((rows) => Effect.forEach(rows, decodeGrant))),
          "Failed to find active grants for app",
        ),

      hasOtherActiveMappingTo: (params) =>
        withErr(
          sql`SELECT 1 FROM grants g
              JOIN connector_mappings m ON m.local_role_id = g.role_id
              WHERE g.principal_id = ${params.principalId}
                AND m.connected_system_id = ${params.connectedSystemId}
                AND m.external_role_identifier = ${params.externalRoleIdentifier}
                AND g.id != ${params.excludeGrantId}
                AND g.revoked_at IS NULL
                AND (g.expires_at IS NULL OR g.expires_at > NOW())
              LIMIT 1`.pipe(Effect.map((rows) => rows.length > 0)),
          "Failed to check for other active mappings",
        ),

      findExpired: () =>
        withErr(
          sql`SELECT * FROM grants
              WHERE revoked_at IS NULL
                AND expires_at IS NOT NULL
                AND expires_at <= NOW()`.pipe(Effect.flatMap((rows) => Effect.forEach(rows, decodeGrant))),
          "Failed to find expired grants",
        ),

      exportActive: (filter) => {
        // A null slug disables the filter in-query, so the optional filter
        // stays one statement instead of two near-identical variants. The cast
        // is required: Postgres cannot infer a bare parameter's type in
        // `IS NULL`.
        const slug = filter?.applicationSlug ?? null
        return withErr(
          sql`SELECT
                g.id,
                g.principal_id,
                p.external_id   AS principal_external_id,
                p.display_name  AS principal_display_name,
                p.email         AS principal_email,
                p.principal_type,
                a.slug          AS application_slug,
                a.display_name  AS application_display_name,
                r.slug          AS role_slug,
                r.display_name  AS role_display_name,
                e.slug          AS entitlement_slug,
                e.display_name  AS entitlement_display_name,
                res.external_id  AS resource_external_id,
                res.display_name AS resource_display_name,
                g.granted_by    AS granted_by_id,
                gb.external_id  AS granted_by_external_id,
                gb.display_name AS granted_by_display_name,
                g.reason,
                g.expires_at,
                g.created_at,
                CASE WHEN p.principal_type = 'group' THEN (
                  SELECT COALESCE(json_agg(json_build_object(
                    'id', m.id,
                    'externalId', m.external_id,
                    'displayName', m.display_name,
                    'email', m.email,
                    'principalType', m.principal_type
                  ) ORDER BY m.display_name), '[]'::json)
                  FROM group_memberships gm
                  JOIN principals m ON m.id = gm.member_id
                  WHERE gm.group_id = p.id
                ) ELSE NULL END AS members
              FROM grants g
              JOIN principals p ON p.id = g.principal_id
              LEFT JOIN roles r ON r.id = g.role_id
              LEFT JOIN entitlements e ON e.id = g.entitlement_id
              JOIN applications a ON a.id = COALESCE(r.application_id, e.application_id)
              LEFT JOIN resources res ON res.id = g.resource_id
              LEFT JOIN principals gb ON gb.id = g.granted_by
              WHERE g.revoked_at IS NULL
                AND (g.expires_at IS NULL OR g.expires_at > NOW())
                AND (${slug}::text IS NULL OR a.slug = ${slug})
              ORDER BY g.created_at ASC, g.id ASC`.pipe(
            Effect.flatMap((rows) => Effect.forEach(rows, decodeGrantExportRow)),
          ),
          "Failed to export active grants",
        )
      },
    }
  }),
)
