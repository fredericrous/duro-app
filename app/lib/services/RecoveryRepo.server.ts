import { Context, Effect, Data, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import * as SqlError from "@effect/sql/SqlError"
import * as crypto from "node:crypto"
import { MigrationsRan } from "~/lib/db/client.server"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecoveryStatus = "pending" | "approved" | "denied"

export interface RecoveryRequest {
  id: string
  email: string
  username: string
  note: string | null
  status: RecoveryStatus
  requestIp: string | null
  renewalId: string | null
  createdAt: string
  reviewedAt: string | null
  reviewedBy: string | null
}

export interface CreateRecoveryInput {
  email: string
  username: string
  note?: string | null
  requestIp?: string | null
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class RecoveryRepoError extends Data.TaggedError("RecoveryRepoError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

export class RecoveryRepo extends Context.Tag("RecoveryRepo")<
  RecoveryRepo,
  {
    readonly create: (input: CreateRecoveryInput) => Effect.Effect<{ id: string }, RecoveryRepoError>
    readonly listByStatus: (status: RecoveryStatus) => Effect.Effect<RecoveryRequest[], RecoveryRepoError>
    readonly findById: (id: string) => Effect.Effect<RecoveryRequest | null, RecoveryRepoError>
    readonly findPendingByEmail: (email: string) => Effect.Effect<RecoveryRequest | null, RecoveryRepoError>
    /** Stamp a review outcome. Ownership-free (admin action). Returns affected count. */
    readonly markReviewed: (
      id: string,
      status: "approved" | "denied",
      reviewedBy: string,
      renewalId?: string | null,
    ) => Effect.Effect<number, RecoveryRepoError>
    /** Count requests (any status) for an email since `sinceIso` — rate limiting. */
    readonly countRecentByEmail: (email: string, sinceIso: string) => Effect.Effect<number, RecoveryRepoError>
    /** Count requests (any status) from an IP since `sinceIso` — rate limiting. */
    readonly countRecentByIp: (ip: string, sinceIso: string) => Effect.Effect<number, RecoveryRepoError>
  }
>() {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const withErr = <A>(effect: Effect.Effect<A, SqlError.SqlError>, message: string) =>
  effect.pipe(Effect.mapError((e) => new RecoveryRepoError({ message, cause: e })))

const toRow = (r: any): RecoveryRequest => ({
  id: r.id,
  email: r.email,
  username: r.username,
  note: r.note ?? null,
  status: r.status as RecoveryStatus,
  requestIp: r.requestIp ?? null,
  renewalId: r.renewalId ?? null,
  createdAt: r.createdAt,
  reviewedAt: r.reviewedAt ?? null,
  reviewedBy: r.reviewedBy ?? null,
})

// ---------------------------------------------------------------------------
// Live layer
// ---------------------------------------------------------------------------

export const RecoveryRepoLive = Layer.effect(
  RecoveryRepo,
  Effect.gen(function* () {
    yield* MigrationsRan
    const sql = yield* SqlClient.SqlClient

    return {
      create: (input: CreateRecoveryInput) => {
        const id = crypto.randomUUID()
        const note = input.note ?? null
        const requestIp = input.requestIp ?? null
        return withErr(
          sql`INSERT INTO recovery_requests (id, email, username, note, request_ip)
              VALUES (${id}, ${input.email}, ${input.username}, ${note}, ${requestIp})`.pipe(Effect.as({ id })),
          "Failed to create recovery request",
        )
      },

      listByStatus: (status: RecoveryStatus) =>
        withErr(
          sql`SELECT * FROM recovery_requests WHERE status = ${status} ORDER BY created_at DESC`.pipe(
            Effect.map((rows) => rows.map(toRow)),
          ),
          "Failed to list recovery requests",
        ),

      findById: (id: string) =>
        withErr(
          sql`SELECT * FROM recovery_requests WHERE id = ${id}`.pipe(
            Effect.map((rows) => (rows[0] ? toRow(rows[0]) : null)),
          ),
          "Failed to find recovery request",
        ),

      findPendingByEmail: (email: string) =>
        withErr(
          sql`SELECT * FROM recovery_requests WHERE email = ${email} AND status = 'pending' LIMIT 1`.pipe(
            Effect.map((rows) => (rows[0] ? toRow(rows[0]) : null)),
          ),
          "Failed to find pending recovery request",
        ),

      markReviewed: (id, status, reviewedBy, renewalId) =>
        withErr(
          sql`UPDATE recovery_requests
              SET status = ${status}, reviewed_at = NOW(), reviewed_by = ${reviewedBy}, renewal_id = ${renewalId ?? null}
              WHERE id = ${id} AND status = 'pending'
              RETURNING id`.pipe(Effect.map((rows) => rows.length)),
          "Failed to mark recovery request reviewed",
        ),

      countRecentByEmail: (email, sinceIso) =>
        withErr(
          sql`SELECT COUNT(*)::int AS n FROM recovery_requests WHERE email = ${email} AND created_at > ${sinceIso}`.pipe(
            Effect.map((rows) => Number((rows[0] as any)?.n ?? 0)),
          ),
          "Failed to count recovery requests by email",
        ),

      countRecentByIp: (ip, sinceIso) =>
        withErr(
          sql`SELECT COUNT(*)::int AS n FROM recovery_requests WHERE request_ip = ${ip} AND created_at > ${sinceIso}`.pipe(
            Effect.map((rows) => Number((rows[0] as any)?.n ?? 0)),
          ),
          "Failed to count recovery requests by ip",
        ),
    }
  }),
)
