import { Context, Effect, Data, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import * as SqlError from "@effect/sql/SqlError"
import { MigrationsRan } from "~/lib/db/client.server"
import { decodeGrant, type Grant } from "./types"

export class GrantRepoError extends Data.TaggedError("GrantRepoError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

const withErr = <A>(effect: Effect.Effect<A, SqlError.SqlError>, message: string) =>
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
    readonly revoke: (id: string, revokedBy: string) => Effect.Effect<void, GrantRepoError>
    readonly findById: (id: string) => Effect.Effect<Grant | null, GrantRepoError>
    readonly findActiveForPrincipal: (principalId: string) => Effect.Effect<Grant[], GrantRepoError>
    readonly findActiveForPrincipalAndApp: (
      principalId: string,
      applicationId: string,
    ) => Effect.Effect<Grant[], GrantRepoError>
    readonly findActiveForApp: (applicationId: string) => Effect.Effect<Grant[], GrantRepoError>
    readonly findExpired: () => Effect.Effect<Grant[], GrantRepoError>
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
              RETURNING *`.pipe(Effect.map((rows) => decodeGrant(rows[0]) as Grant)),
          "Failed to grant role",
        ),

      grantEntitlement: (input) =>
        withErr(
          sql`INSERT INTO grants (principal_id, entitlement_id, resource_id, granted_by, reason, expires_at)
              VALUES (${input.principalId}, ${input.entitlementId}, ${input.resourceId ?? null}, ${input.grantedBy}, ${input.reason ?? null}, ${input.expiresAt ?? null})
              RETURNING *`.pipe(Effect.map((rows) => decodeGrant(rows[0]) as Grant)),
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
            Effect.map((rows) => (rows.length > 0 ? (decodeGrant(rows[0]) as Grant) : null)),
          ),
          "Failed to find grant",
        ),

      findActiveForPrincipal: (principalId) =>
        withErr(
          sql`SELECT * FROM grants
              WHERE principal_id = ${principalId}
                AND revoked_at IS NULL
                AND (expires_at IS NULL OR expires_at > NOW())`.pipe(
            Effect.map((rows) => rows.map((r) => decodeGrant(r) as Grant)),
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
                )`.pipe(Effect.map((rows) => rows.map((r) => decodeGrant(r) as Grant))),
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
                )`.pipe(Effect.map((rows) => rows.map((r) => decodeGrant(r) as Grant))),
          "Failed to find active grants for app",
        ),

      findExpired: () =>
        withErr(
          sql`SELECT * FROM grants
              WHERE revoked_at IS NULL
                AND expires_at IS NOT NULL
                AND expires_at <= NOW()`.pipe(Effect.map((rows) => rows.map((r) => decodeGrant(r) as Grant))),
          "Failed to find expired grants",
        ),
    }
  }),
)
