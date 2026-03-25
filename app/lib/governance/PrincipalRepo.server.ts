import { Context, Effect, Data, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import * as SqlError from "@effect/sql/SqlError"
import { MigrationsRan } from "~/lib/db/client.server"
import { decodePrincipal, type Principal } from "./types"

export class PrincipalRepoError extends Data.TaggedError("PrincipalRepoError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

const withErr = <A>(effect: Effect.Effect<A, SqlError.SqlError>, message: string) =>
  effect.pipe(Effect.mapError((e) => new PrincipalRepoError({ message, cause: e })))

export class PrincipalRepo extends Context.Tag("PrincipalRepo")<
  PrincipalRepo,
  {
    readonly ensureUser: (
      externalId: string,
      displayName: string,
      email: string,
    ) => Effect.Effect<Principal, PrincipalRepoError>
    readonly findById: (id: string) => Effect.Effect<Principal | null, PrincipalRepoError>
    readonly findByExternalId: (externalId: string) => Effect.Effect<Principal | null, PrincipalRepoError>
    readonly list: () => Effect.Effect<Principal[], PrincipalRepoError>
    readonly createGroup: (displayName: string, externalId?: string) => Effect.Effect<Principal, PrincipalRepoError>
    readonly addMembership: (groupId: string, memberId: string) => Effect.Effect<void, PrincipalRepoError>
    readonly removeMembership: (groupId: string, memberId: string) => Effect.Effect<void, PrincipalRepoError>
    readonly listGroupsFor: (principalId: string) => Effect.Effect<Principal[], PrincipalRepoError>
    readonly listMembers: (groupId: string) => Effect.Effect<Principal[], PrincipalRepoError>
    readonly disable: (id: string) => Effect.Effect<void, PrincipalRepoError>
  }
>() {}

export const PrincipalRepoLive = Layer.effect(
  PrincipalRepo,
  Effect.gen(function* () {
    yield* MigrationsRan
    const sql = yield* SqlClient.SqlClient

    return {
      ensureUser: (externalId, displayName, email) =>
        withErr(
          Effect.gen(function* () {
            const existing = yield* sql`SELECT * FROM principals WHERE external_id = ${externalId}`
            if (existing.length > 0) {
              const rows = yield* sql`UPDATE principals
                SET display_name = ${displayName}, email = ${email}, updated_at = NOW()
                WHERE external_id = ${externalId}
                RETURNING *`
              return decodePrincipal(rows[0])
            }
            const rows = yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
              VALUES (gen_random_uuid(), 'user', ${externalId}, ${displayName}, ${email})
              RETURNING *`
            return decodePrincipal(rows[0])
          }),
          "Failed to ensure user",
        ),

      findById: (id) =>
        withErr(
          sql`SELECT * FROM principals WHERE id = ${id}`.pipe(
            Effect.map((rows) => (rows[0] ? decodePrincipal(rows[0]) : null)),
          ),
          "Failed to find principal by id",
        ),

      findByExternalId: (externalId) =>
        withErr(
          sql`SELECT * FROM principals WHERE external_id = ${externalId}`.pipe(
            Effect.map((rows) => (rows[0] ? decodePrincipal(rows[0]) : null)),
          ),
          "Failed to find principal by external id",
        ),

      list: () =>
        withErr(
          sql`SELECT * FROM principals ORDER BY display_name`.pipe(
            Effect.map((rows) => rows.map((r) => decodePrincipal(r))),
          ),
          "Failed to list principals",
        ),

      createGroup: (displayName, externalId?) =>
        withErr(
          sql`INSERT INTO principals (id, principal_type, display_name, external_id)
              VALUES (gen_random_uuid(), 'group', ${displayName}, ${externalId ?? null})
              RETURNING *`.pipe(Effect.map((rows) => decodePrincipal(rows[0]))),
          "Failed to create group",
        ),

      addMembership: (groupId, memberId) =>
        withErr(
          sql`INSERT INTO group_memberships (group_id, member_id)
              VALUES (${groupId}, ${memberId})
              ON CONFLICT DO NOTHING`.pipe(Effect.asVoid),
          "Failed to add membership",
        ),

      removeMembership: (groupId, memberId) =>
        withErr(
          sql`DELETE FROM group_memberships WHERE group_id = ${groupId} AND member_id = ${memberId}`.pipe(
            Effect.asVoid,
          ),
          "Failed to remove membership",
        ),

      listGroupsFor: (principalId) =>
        withErr(
          sql`SELECT p.* FROM principals p
              JOIN group_memberships gm ON gm.group_id = p.id
              WHERE gm.member_id = ${principalId}`.pipe(Effect.map((rows) => rows.map((r) => decodePrincipal(r)))),
          "Failed to list groups for principal",
        ),

      listMembers: (groupId) =>
        withErr(
          sql`SELECT p.* FROM principals p
              JOIN group_memberships gm ON gm.member_id = p.id
              WHERE gm.group_id = ${groupId}`.pipe(Effect.map((rows) => rows.map((r) => decodePrincipal(r)))),
          "Failed to list group members",
        ),

      disable: (id) =>
        withErr(
          sql`UPDATE principals SET enabled = false, updated_at = NOW() WHERE id = ${id}`.pipe(Effect.asVoid),
          "Failed to disable principal",
        ),
    }
  }),
)
