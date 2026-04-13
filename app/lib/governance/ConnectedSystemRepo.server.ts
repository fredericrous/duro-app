import { Context, Effect, Data, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import * as SqlError from "@effect/sql/SqlError"
import { MigrationsRan } from "~/lib/db/client.server"
import { decodeConnectedSystem, type ConnectedSystem } from "./types"

export class ConnectedSystemRepoError extends Data.TaggedError("ConnectedSystemRepoError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

const withErr = <A>(effect: Effect.Effect<A, SqlError.SqlError>, message: string) =>
  effect.pipe(Effect.mapError((e) => new ConnectedSystemRepoError({ message, cause: e })))

export class ConnectedSystemRepo extends Context.Tag("ConnectedSystemRepo")<
  ConnectedSystemRepo,
  {
    readonly create: (input: {
      applicationId: string
      connectorType: "http" | "ldap" | "scim" | "webhook" | "plugin"
      config: Record<string, unknown>
      status?: "active" | "disabled" | "error"
      pluginSlug?: string
      pluginVersion?: string
    }) => Effect.Effect<ConnectedSystem, ConnectedSystemRepoError>
    readonly findById: (id: string) => Effect.Effect<ConnectedSystem | null, ConnectedSystemRepoError>
    readonly findByApplicationAndType: (
      applicationId: string,
      connectorType: string,
    ) => Effect.Effect<ConnectedSystem | null, ConnectedSystemRepoError>
    readonly findByApplicationAndPlugin: (
      applicationId: string,
      pluginSlug: string,
    ) => Effect.Effect<ConnectedSystem | null, ConnectedSystemRepoError>
    readonly countByPluginSlug: () => Effect.Effect<
      ReadonlyArray<{ pluginSlug: string; count: number }>,
      ConnectedSystemRepoError
    >
    readonly listByApplication: (applicationId: string) => Effect.Effect<ConnectedSystem[], ConnectedSystemRepoError>
  }
>() {}

export const ConnectedSystemRepoLive = Layer.effect(
  ConnectedSystemRepo,
  Effect.gen(function* () {
    yield* MigrationsRan
    const sql = yield* SqlClient.SqlClient

    return {
      create: (input) =>
        Effect.gen(function* () {
          const status = input.status ?? "active"
          const configJson = JSON.stringify(input.config)
          const pluginSlug = input.pluginSlug ?? null
          const pluginVersion = input.pluginVersion ?? null
          const rows = yield* withErr(
            sql`INSERT INTO connected_systems (application_id, connector_type, config, status, plugin_slug, plugin_version)
                VALUES (${input.applicationId}, ${input.connectorType}, ${configJson}::jsonb, ${status}, ${pluginSlug}, ${pluginVersion})
                RETURNING *`,
            "Failed to create connected system",
          )
          return decodeConnectedSystem(rows[0]) as ConnectedSystem
        }),

      findById: (id) =>
        withErr(
          sql`SELECT * FROM connected_systems WHERE id = ${id}`.pipe(
            Effect.map((rows) => (rows.length > 0 ? (decodeConnectedSystem(rows[0]) as ConnectedSystem) : null)),
          ),
          "Failed to find connected system by id",
        ),

      findByApplicationAndType: (applicationId, connectorType) =>
        withErr(
          sql`SELECT * FROM connected_systems
              WHERE application_id = ${applicationId}
                AND connector_type = ${connectorType}
              LIMIT 1`.pipe(
            Effect.map((rows) => (rows.length > 0 ? (decodeConnectedSystem(rows[0]) as ConnectedSystem) : null)),
          ),
          "Failed to find connected system by application and type",
        ),

      findByApplicationAndPlugin: (applicationId, pluginSlug) =>
        withErr(
          sql`SELECT * FROM connected_systems
              WHERE application_id = ${applicationId}
                AND plugin_slug = ${pluginSlug}
              LIMIT 1`.pipe(
            Effect.map((rows) => (rows.length > 0 ? (decodeConnectedSystem(rows[0]) as ConnectedSystem) : null)),
          ),
          "Failed to find connected system by application and plugin",
        ),

      countByPluginSlug: () =>
        withErr(
          sql<{ pluginSlug: string; count: string }>`
            SELECT plugin_slug, COUNT(*)::text as count
            FROM connected_systems
            WHERE connector_type = 'plugin' AND plugin_slug IS NOT NULL
            GROUP BY plugin_slug
          `.pipe(Effect.map((rows) => rows.map((r) => ({ pluginSlug: r.pluginSlug, count: Number(r.count) })))),
          "Failed to count connected systems by plugin slug",
        ),

      listByApplication: (applicationId) =>
        withErr(
          sql`SELECT * FROM connected_systems WHERE application_id = ${applicationId}`.pipe(
            Effect.map((rows) => rows.map((r) => decodeConnectedSystem(r) as ConnectedSystem)),
          ),
          "Failed to list connected systems for application",
        ),
    }
  }),
)
