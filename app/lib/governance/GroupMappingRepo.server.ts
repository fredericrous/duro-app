import { Context, Effect, Data, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import * as SqlError from "@effect/sql/SqlError"
import { MigrationsRan } from "~/lib/db/client.server"
import { decodeGroupMapping, type GroupMapping } from "./types"

export class GroupMappingRepoError extends Data.TaggedError("GroupMappingRepoError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

const withErr = <A>(effect: Effect.Effect<A, SqlError.SqlError>, message: string) =>
  effect.pipe(Effect.mapError((e) => new GroupMappingRepoError({ message, cause: e })))

export interface GroupMappingWithNames extends GroupMapping {
  readonly principalGroupName: string | null
  readonly roleName: string | null
  readonly applicationName: string | null
}

export class GroupMappingRepo extends Context.Tag("GroupMappingRepo")<
  GroupMappingRepo,
  {
    readonly list: () => Effect.Effect<GroupMappingWithNames[], GroupMappingRepoError>
    readonly create: (input: {
      oidcGroupName: string
      principalGroupId?: string
      roleId?: string
      applicationId?: string
    }) => Effect.Effect<GroupMapping, GroupMappingRepoError>
    readonly remove: (id: string) => Effect.Effect<void, GroupMappingRepoError>
  }
>() {}

export const GroupMappingRepoLive = Layer.effect(
  GroupMappingRepo,
  Effect.gen(function* () {
    yield* MigrationsRan
    const sql = yield* SqlClient.SqlClient

    return {
      list: () =>
        withErr(
          sql`SELECT gm.*,
                     pg.display_name AS principal_group_name,
                     r.display_name  AS role_name,
                     a.display_name  AS application_name
              FROM group_mappings gm
              LEFT JOIN principals pg ON pg.id = gm.principal_group_id
              LEFT JOIN roles r       ON r.id = gm.role_id
              LEFT JOIN applications a ON a.id = gm.application_id
              ORDER BY gm.created_at DESC`.pipe(
            Effect.map((rows) =>
              rows.map((r) => ({
                ...decodeGroupMapping(r),
                principalGroupName: (r as any).principalGroupName ?? null,
                roleName: (r as any).roleName ?? null,
                applicationName: (r as any).applicationName ?? null,
              })),
            ),
          ),
          "Failed to list group mappings",
        ),

      create: (input) =>
        withErr(
          sql`INSERT INTO group_mappings (oidc_group_name, principal_group_id, role_id, application_id)
              VALUES (${input.oidcGroupName}, ${input.principalGroupId ?? null}, ${input.roleId ?? null}, ${input.applicationId ?? null})
              RETURNING *`.pipe(Effect.map((rows) => decodeGroupMapping(rows[0]) as GroupMapping)),
          "Failed to create group mapping",
        ),

      remove: (id) =>
        withErr(
          sql`DELETE FROM group_mappings WHERE id = ${id}`.pipe(Effect.asVoid),
          "Failed to delete group mapping",
        ),
    }
  }),
)
