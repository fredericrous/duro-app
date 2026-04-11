import { Context, Effect, Data, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import * as SqlError from "@effect/sql/SqlError"
import { MigrationsRan } from "~/lib/db/client.server"
import { decodeConnectorMapping, type ConnectorMapping } from "./types"

export class ConnectorMappingRepoError extends Data.TaggedError("ConnectorMappingRepoError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

const withErr = <A>(effect: Effect.Effect<A, SqlError.SqlError>, message: string) =>
  effect.pipe(Effect.mapError((e) => new ConnectorMappingRepoError({ message, cause: e })))

export class ConnectorMappingRepo extends Context.Tag("ConnectorMappingRepo")<
  ConnectorMappingRepo,
  {
    readonly create: (input: {
      connectedSystemId: string
      localRoleId?: string
      localEntitlementId?: string
      externalRoleIdentifier: string
      direction?: "push" | "pull" | "bidirectional"
    }) => Effect.Effect<ConnectorMapping, ConnectorMappingRepoError>
    readonly findByConnectedSystemAndRole: (
      connectedSystemId: string,
      localRoleId: string,
    ) => Effect.Effect<ConnectorMapping | null, ConnectorMappingRepoError>
    readonly listByConnectedSystem: (
      connectedSystemId: string,
    ) => Effect.Effect<ConnectorMapping[], ConnectorMappingRepoError>
    readonly ensureForRole: (input: {
      connectedSystemId: string
      localRoleId: string
      externalRoleIdentifier: string
      direction?: "push" | "pull" | "bidirectional"
    }) => Effect.Effect<ConnectorMapping, ConnectorMappingRepoError>
  }
>() {}

export const ConnectorMappingRepoLive = Layer.effect(
  ConnectorMappingRepo,
  Effect.gen(function* () {
    yield* MigrationsRan
    const sql = yield* SqlClient.SqlClient

    const insert = (input: {
      connectedSystemId: string
      localRoleId?: string
      localEntitlementId?: string
      externalRoleIdentifier: string
      direction?: "push" | "pull" | "bidirectional"
    }) =>
      withErr(
        sql`INSERT INTO connector_mappings
              (connected_system_id, local_role_id, local_entitlement_id, external_role_identifier, direction)
            VALUES (
              ${input.connectedSystemId},
              ${input.localRoleId ?? null},
              ${input.localEntitlementId ?? null},
              ${input.externalRoleIdentifier},
              ${input.direction ?? "push"}
            )
            RETURNING *`.pipe(Effect.map((rows) => decodeConnectorMapping(rows[0]) as ConnectorMapping)),
        "Failed to create connector mapping",
      )

    const findByConnectedSystemAndRole = (connectedSystemId: string, localRoleId: string) =>
      withErr(
        sql`SELECT * FROM connector_mappings
            WHERE connected_system_id = ${connectedSystemId}
              AND local_role_id = ${localRoleId}
            LIMIT 1`.pipe(
          Effect.map((rows) => (rows.length > 0 ? (decodeConnectorMapping(rows[0]) as ConnectorMapping) : null)),
        ),
        "Failed to find connector mapping",
      )

    return {
      create: insert,

      findByConnectedSystemAndRole,

      listByConnectedSystem: (connectedSystemId) =>
        withErr(
          sql`SELECT * FROM connector_mappings WHERE connected_system_id = ${connectedSystemId}`.pipe(
            Effect.map((rows) => rows.map((r) => decodeConnectorMapping(r) as ConnectorMapping)),
          ),
          "Failed to list connector mappings",
        ),

      ensureForRole: (input) =>
        Effect.gen(function* () {
          const existing = yield* findByConnectedSystemAndRole(input.connectedSystemId, input.localRoleId)
          if (existing) return existing
          return yield* insert({ ...input, localEntitlementId: undefined })
        }),
    }
  }),
)
