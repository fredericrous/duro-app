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

export interface CreateApiKeyInput {
  readonly principalId: string
  readonly name: string
  readonly scopes: string[]
  /** Lifetime in days. Omit/null for non-expiring. */
  readonly expiresInDays?: number | null
}

export class ApiKeyRepo extends Context.Tag("ApiKeyRepo")<
  ApiKeyRepo,
  {
    readonly create: (
      input: CreateApiKeyInput,
    ) => Effect.Effect<{ id: string; rawKey: string; keyPreview: string }, ApiKeyRepoError>
    readonly verify: (
      rawKey: string,
    ) => Effect.Effect<{ principalId: string; scopes: string[] } | null, ApiKeyRepoError>
    readonly revoke: (id: string) => Effect.Effect<void, ApiKeyRepoError>
    readonly listForPrincipal: (principalId: string) => Effect.Effect<ApiKey[], ApiKeyRepoError>
  }
>() {}

/**
 * Show enough of the key to disambiguate ("the one ending in 7f3a")
 * without leaking enough to be useful — 4 leading hex chars after the
 * `duro_` prefix + 4 trailing chars is 32 bits of disclosed entropy out
 * of 256, so an attacker who sees this still has 224 bits to brute-force.
 */
function makeKeyPreview(rawKey: string): string {
  // rawKey shape: duro_<64 hex chars>
  const body = rawKey.slice(5) // strip "duro_"
  if (body.length < 8) return `${rawKey.slice(0, 5)}…`
  return `duro_${body.slice(0, 4)}…${body.slice(-4)}`
}

export const ApiKeyRepoLive = Layer.effect(
  ApiKeyRepo,
  Effect.gen(function* () {
    yield* MigrationsRan
    const sql = yield* SqlClient.SqlClient

    return {
      create: ({ principalId, name, scopes, expiresInDays }) => {
        const rawKey = "duro_" + crypto.randomBytes(32).toString("hex")
        const keyHash = hashToken(rawKey)
        const keyPreview = makeKeyPreview(rawKey)
        const scopesJson = JSON.stringify(scopes)
        const expiresAt =
          typeof expiresInDays === "number" && expiresInDays > 0
            ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
            : null

        return withErr(
          sql`INSERT INTO api_keys (id, principal_id, key_hash, key_preview, name, scopes, expires_at)
              VALUES (gen_random_uuid(), ${principalId}, ${keyHash}, ${keyPreview}, ${name}, ${scopesJson}, ${expiresAt})
              RETURNING id`.pipe(Effect.map((rows) => ({ id: (rows[0] as { id: string }).id, rawKey, keyPreview }))),
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
              // scopes is JSONB; the pg driver returns it pre-parsed as an
              // array, so we just narrow the Unknown to string[]. The old
              // `JSON.parse(row.scopes as string)` here double-decoded:
              // `JSON.parse(["read","write"])` coerced via toString to
              // `"read,write"`, which JSON.parse then rejected. That broke
              // verification for every multi-scope key — and even the default
              // `["*"]` would throw via `JSON.parse("*")`.
              return { principalId: row.principalId, scopes: row.scopes as string[] }
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
