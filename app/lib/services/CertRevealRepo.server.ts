import { Context, Effect, Data, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import * as SqlError from "@effect/sql/SqlError"
import * as crypto from "node:crypto"
import { MigrationsRan } from "~/lib/db/client.server"
import { hashToken } from "~/lib/crypto.server"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CertRevealToken {
  id: string
  renewalId: string
  email: string
  username: string
  createdAt: string
  expiresAt: string
  revealedAt: string | null
}

export interface CreateRevealInput {
  renewalId: string
  email: string
  username: string
  expiresAt: Date
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class CertRevealRepoError extends Data.TaggedError("CertRevealRepoError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

export class CertRevealRepo extends Context.Tag("CertRevealRepo")<
  CertRevealRepo,
  {
    /** Mint a single-use reveal token. Returns the RAW token (only place it exists outside the email URL). */
    readonly create: (input: CreateRevealInput) => Effect.Effect<{ id: string; token: string }, CertRevealRepoError>
    readonly findByTokenHash: (tokenHash: string) => Effect.Effect<CertRevealToken | null, CertRevealRepoError>
    /** Stamp revealed_at. Idempotent — a no-op if already revealed. */
    readonly markRevealed: (id: string) => Effect.Effect<void, CertRevealRepoError>
  }
>() {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const withErr = <A>(effect: Effect.Effect<A, SqlError.SqlError>, message: string) =>
  effect.pipe(Effect.mapError((e) => new CertRevealRepoError({ message, cause: e })))

const toRow = (r: any): CertRevealToken => ({
  id: r.id,
  renewalId: r.renewalId,
  email: r.email,
  username: r.username,
  createdAt: r.createdAt,
  expiresAt: r.expiresAt,
  revealedAt: r.revealedAt ?? null,
})

// ---------------------------------------------------------------------------
// Live layer
// ---------------------------------------------------------------------------

export const CertRevealRepoLive = Layer.effect(
  CertRevealRepo,
  Effect.gen(function* () {
    yield* MigrationsRan
    const sql = yield* SqlClient.SqlClient

    return {
      create: (input: CreateRevealInput) => {
        const id = crypto.randomUUID()
        const token = crypto.randomBytes(32).toString("base64url")
        const tokenHash = hashToken(token)
        const expiresAt = input.expiresAt.toISOString()
        return withErr(
          sql`INSERT INTO cert_reveal_tokens (id, token_hash, renewal_id, email, username, expires_at)
              VALUES (${id}, ${tokenHash}, ${input.renewalId}, ${input.email}, ${input.username}, ${expiresAt})`.pipe(
            Effect.as({ id, token }),
          ),
          "Failed to create cert reveal token",
        )
      },

      findByTokenHash: (tokenHash: string) =>
        withErr(
          sql`SELECT * FROM cert_reveal_tokens WHERE token_hash = ${tokenHash}`.pipe(
            Effect.map((rows) => (rows[0] ? toRow(rows[0]) : null)),
          ),
          "Failed to find cert reveal token",
        ),

      markRevealed: (id: string) =>
        withErr(
          sql`UPDATE cert_reveal_tokens SET revealed_at = NOW() WHERE id = ${id} AND revealed_at IS NULL`.pipe(
            Effect.asVoid,
          ),
          "Failed to mark cert reveal token revealed",
        ),
    }
  }),
)
