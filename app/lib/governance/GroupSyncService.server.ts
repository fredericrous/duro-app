import { Context, Effect, Data, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import * as SqlError from "@effect/sql/SqlError"
import { MigrationsRan } from "~/lib/db/client.server"

export class GroupSyncError extends Data.TaggedError("GroupSyncError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

const withErr = <A>(effect: Effect.Effect<A, SqlError.SqlError>, message: string) =>
  effect.pipe(Effect.mapError((e) => new GroupSyncError({ message, cause: e })))

export class GroupSyncService extends Context.Tag("GroupSyncService")<
  GroupSyncService,
  {
    readonly syncGroups: (principalId: string, oidcGroups: string[]) => Effect.Effect<void, GroupSyncError>
  }
>() {}

export const GroupSyncServiceLive = Layer.effect(
  GroupSyncService,
  Effect.gen(function* () {
    yield* MigrationsRan
    const sql = yield* SqlClient.SqlClient

    return {
      syncGroups: (principalId, oidcGroups) =>
        withErr(
          Effect.gen(function* () {
            // Get all mappings for the user's OIDC groups
            const mappings = yield* sql`SELECT * FROM group_mappings WHERE oidc_group_name = ANY(${oidcGroups})`

            for (const mapping of mappings) {
              const m = mapping as any
              if (m.principalGroupId) {
                // Ensure group membership
                yield* sql`
                  INSERT INTO group_memberships (group_id, member_id)
                  VALUES (${m.principalGroupId}, ${principalId})
                  ON CONFLICT (group_id, member_id) DO NOTHING
                `
              }
              if (m.roleId && m.applicationId) {
                // Check if a synced grant already exists (avoid duplicates)
                const existing = yield* sql`
                  SELECT id FROM grants
                  WHERE principal_id = ${principalId}
                    AND role_id = ${m.roleId}
                    AND revoked_at IS NULL
                    AND reason = 'auto-synced from OIDC group'
                `
                if (existing.length === 0) {
                  yield* sql`
                    INSERT INTO grants (principal_id, role_id, granted_by, reason)
                    VALUES (${principalId}, ${m.roleId}, ${principalId}, 'auto-synced from OIDC group')
                  `
                }
              }
            }

            // Remove memberships for groups no longer in OIDC claims
            yield* sql`
              DELETE FROM group_memberships
              WHERE member_id = ${principalId}
                AND group_id IN (
                  SELECT principal_group_id FROM group_mappings
                  WHERE principal_group_id IS NOT NULL
                    AND oidc_group_name != ALL(${oidcGroups})
                )
            `

            // Revoke auto-synced grants for roles whose OIDC group is no longer present
            yield* sql`
              UPDATE grants SET revoked_at = NOW(), revoked_by = ${principalId}
              WHERE principal_id = ${principalId}
                AND reason = 'auto-synced from OIDC group'
                AND revoked_at IS NULL
                AND role_id IN (
                  SELECT role_id FROM group_mappings
                  WHERE role_id IS NOT NULL
                    AND oidc_group_name != ALL(${oidcGroups})
                )
            `
          }),
          "Failed to sync groups",
        ),
    }
  }),
)
