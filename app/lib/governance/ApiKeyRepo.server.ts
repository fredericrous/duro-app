import { Context, Effect, Data, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import * as SqlError from "@effect/sql/SqlError"
import * as crypto from "node:crypto"
import { MigrationsRan } from "~/lib/db/client.server"
import { hashToken } from "~/lib/crypto.server"
import { decodeApiKey, type ApiKey } from "./types"

export class ApiKeyRepoError extends Data.TaggedError("ApiKeyRepoError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

const withErr = <A>(effect: Effect.Effect<A, SqlError.SqlError>, message: string) =>
  effect.pipe(Effect.mapError((e) => new ApiKeyRepoError({ message, cause: e })))

export class ApiKeyRepo extends Context.Tag("ApiKeyRepo")<
  ApiKeyRepo,
  {
    readonly create: (
      principalId: string,
      name: string,
      scopes: string[],
    ) => Effect.Effect<{ id: string; rawKey: string }, ApiKeyRepoError>
    readonly verify: (
      rawKey: string,
    ) => Effect.Effect<{ principalId: string; scopes: string[] } | null, ApiKeyRepoError>
    readonly revoke: (id: string) => Effect.Effect<void, ApiKeyRepoError>
    readonly listForPrincipal: (principalId: string) => Effect.Effect<ApiKey[], ApiKeyRepoError>
  }
>() {}

export const ApiKeyRepoLive = Layer.effect(
  ApiKeyRepo,
  Effect.gen(function* () {
    yield* MigrationsRan
    const sql = yield* SqlClient.SqlClient

    return {
      create: (principalId, name, scopes) => {
        const rawKey = "duro_" + crypto.randomBytes(32).toString("hex")
        const keyHash = hashToken(rawKey)
        const scopesJson = JSON.stringify(scopes)

        return withErr(
          sql`INSERT INTO api_keys (id, principal_id, key_hash, name, scopes)
              VALUES (gen_random_uuid(), ${principalId}, ${keyHash}, ${name}, ${scopesJson})
              RETURNING id`.pipe(Effect.map((rows) => ({ id: (rows[0] as any).id as string, rawKey }))),
          "Failed to create API key",
        )
      },

      verify: (rawKey) => {
        const keyHash = hashToken(rawKey)

        return withErr(
          sql`SELECT * FROM api_keys
              WHERE key_hash = ${keyHash}
                AND revoked_at IS NULL
                AND (expires_at IS NULL OR expires_at > NOW())`.pipe(
            Effect.map((rows) => {
              if (!rows[0]) return null
              const row = decodeApiKey(rows[0])
              return { principalId: row.principalId, scopes: JSON.parse(row.scopes as string) as string[] }
            }),
          ),
          "Failed to verify API key",
        )
      },

      revoke: (id) =>
        withErr(
          sql`UPDATE api_keys SET revoked_at = NOW() WHERE id = ${id}`.pipe(Effect.asVoid),
          "Failed to revoke API key",
        ),

      listForPrincipal: (principalId) =>
        withErr(
          sql`SELECT * FROM api_keys WHERE principal_id = ${principalId} ORDER BY created_at DESC`.pipe(
            Effect.map((rows) => rows.map((r) => decodeApiKey(r))),
          ),
          "Failed to list API keys for principal",
        ),
    }
  }),
)
