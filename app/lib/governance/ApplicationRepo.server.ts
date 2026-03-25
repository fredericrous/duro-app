import { Context, Effect, Data, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import * as SqlError from "@effect/sql/SqlError"
import { MigrationsRan } from "~/lib/db/client.server"
import { decodeApplication, type Application } from "./types"
import * as crypto from "node:crypto"

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class ApplicationRepoError extends Data.TaggedError("ApplicationRepoError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

export class ApplicationRepo extends Context.Tag("ApplicationRepo")<
  ApplicationRepo,
  {
    readonly create: (input: {
      slug: string
      displayName: string
      description?: string
      accessMode?: string
      ownerId?: string
    }) => Effect.Effect<Application, ApplicationRepoError>
    readonly findById: (id: string) => Effect.Effect<Application | null, ApplicationRepoError>
    readonly findBySlug: (slug: string) => Effect.Effect<Application | null, ApplicationRepoError>
    readonly list: () => Effect.Effect<Application[], ApplicationRepoError>
    readonly update: (
      id: string,
      fields: Partial<{
        displayName: string
        description: string
        accessMode: string
        enabled: boolean
        ownerId: string
      }>,
    ) => Effect.Effect<void, ApplicationRepoError>
  }
>() {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const withErr = <A>(effect: Effect.Effect<A, SqlError.SqlError>, message: string) =>
  effect.pipe(Effect.mapError((e) => new ApplicationRepoError({ message, cause: e })))

// ---------------------------------------------------------------------------
// Live implementation
// ---------------------------------------------------------------------------

export const ApplicationRepoLive = Layer.effect(
  ApplicationRepo,
  Effect.gen(function* () {
    yield* MigrationsRan
    const sql = yield* SqlClient.SqlClient

    return {
      create: (input) =>
        Effect.gen(function* () {
          const id = crypto.randomUUID()
          const accessMode = input.accessMode ?? "invite_only"
          const description = input.description ?? null
          const ownerId = input.ownerId ?? null

          const rows = yield* withErr(
            sql`INSERT INTO applications (id, slug, display_name, description, access_mode, owner_id)
                VALUES (${id}, ${input.slug}, ${input.displayName}, ${description}, ${accessMode}, ${ownerId})
                RETURNING *`,
            "Failed to create application",
          )

          return decodeApplication(rows[0])
        }),

      findById: (id) =>
        withErr(
          sql`SELECT * FROM applications WHERE id = ${id}`.pipe(
            Effect.map((rows) => (rows.length > 0 ? decodeApplication(rows[0]) : null)),
          ),
          "Failed to find application by id",
        ),

      findBySlug: (slug) =>
        withErr(
          sql`SELECT * FROM applications WHERE slug = ${slug}`.pipe(
            Effect.map((rows) => (rows.length > 0 ? decodeApplication(rows[0]) : null)),
          ),
          "Failed to find application by slug",
        ),

      list: () =>
        withErr(
          sql`SELECT * FROM applications ORDER BY created_at DESC`.pipe(
            Effect.map((rows) => rows.map((r) => decodeApplication(r))),
          ),
          "Failed to list applications",
        ),

      update: (id, fields) =>
        Effect.gen(function* () {
          const displayName = fields.displayName !== undefined ? fields.displayName : null
          const description = fields.description !== undefined ? fields.description : null
          const accessMode = fields.accessMode !== undefined ? fields.accessMode : null
          const enabled = fields.enabled !== undefined ? fields.enabled : null
          const ownerId = fields.ownerId !== undefined ? fields.ownerId : null

          const hasDisplayName = fields.displayName !== undefined
          const hasDescription = fields.description !== undefined
          const hasAccessMode = fields.accessMode !== undefined
          const hasEnabled = fields.enabled !== undefined
          const hasOwnerId = fields.ownerId !== undefined

          yield* withErr(
            sql`UPDATE applications SET
              display_name = CASE WHEN ${hasDisplayName} THEN ${displayName} ELSE display_name END,
              description = CASE WHEN ${hasDescription} THEN ${description} ELSE description END,
              access_mode = CASE WHEN ${hasAccessMode} THEN ${accessMode} ELSE access_mode END,
              enabled = CASE WHEN ${hasEnabled} THEN ${enabled} ELSE enabled END,
              owner_id = CASE WHEN ${hasOwnerId} THEN ${ownerId} ELSE owner_id END,
              updated_at = NOW()
              WHERE id = ${id}`.pipe(Effect.asVoid),
            "Failed to update application",
          )
        }),
    }
  }),
)
