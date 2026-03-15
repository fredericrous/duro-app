import { Context, Effect, Data, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import * as SqlError from "@effect/sql/SqlError"
import * as crypto from "node:crypto"
import { MigrationsRan } from "~/lib/db/client.server"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserCertificate {
  id: string
  inviteId: string | null
  userId: string | null
  username: string
  email: string
  serialNumber: string
  issuedAt: string
  expiresAt: string
  revokedAt: string | null
  revokeState: string | null
  revokeError: string | null
}

export interface StoreCertInput {
  inviteId?: string | null
  userId?: string | null
  username: string
  email: string
  serialNumber: string
  issuedAt: Date
  expiresAt: Date
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class CertificateRepoError extends Data.TaggedError("CertificateRepoError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

export class CertificateRepo extends Context.Tag("CertificateRepo")<
  CertificateRepo,
  {
    readonly store: (cert: StoreCertInput) => Effect.Effect<void, CertificateRepoError>
    readonly listValid: (username: string) => Effect.Effect<UserCertificate[], CertificateRepoError>
    readonly listAllByUsernames: (
      usernames: string[],
    ) => Effect.Effect<Record<string, UserCertificate[]>, CertificateRepoError>
    readonly findBySerial: (serialNumber: string) => Effect.Effect<UserCertificate | null, CertificateRepoError>
    /** Marks cert as revoke-pending. Returns affected row count. Enforces ownership via username. */
    readonly markRevokePending: (serialNumber: string, username?: string) => Effect.Effect<number, CertificateRepoError>
    readonly markRevokeCompleted: (serialNumber: string) => Effect.Effect<void, CertificateRepoError>
    readonly markRevokeFailed: (serialNumber: string, error: string) => Effect.Effect<void, CertificateRepoError>
    /** Marks all active certs as pending and returns their serial numbers. */
    readonly revokeAllForUser: (username: string) => Effect.Effect<string[], CertificateRepoError>
    readonly setUserId: (inviteId: string, userId: string) => Effect.Effect<void, CertificateRepoError>
    readonly updateUsername: (oldUsername: string, newUsername: string) => Effect.Effect<void, CertificateRepoError>
  }
>() {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const withErr = <A>(effect: Effect.Effect<A, SqlError.SqlError>, message: string) =>
  effect.pipe(Effect.mapError((e) => new CertificateRepoError({ message, cause: e })))

const toRow = (r: any): UserCertificate => ({
  id: r.id,
  inviteId: r.inviteId ?? null,
  userId: r.userId ?? null,
  username: r.username,
  email: r.email,
  serialNumber: r.serialNumber,
  issuedAt: r.issuedAt,
  expiresAt: r.expiresAt,
  revokedAt: r.revokedAt ?? null,
  revokeState: r.revokeState ?? null,
  revokeError: r.revokeError ?? null,
})

// ---------------------------------------------------------------------------
// Live layer
// ---------------------------------------------------------------------------

export const CertificateRepoLive = Layer.effect(
  CertificateRepo,
  Effect.gen(function* () {
    yield* MigrationsRan
    const sql = yield* SqlClient.SqlClient

    return {
      store: (cert: StoreCertInput) => {
        const id = crypto.randomUUID()
        const inviteId = cert.inviteId ?? null
        const userId = cert.userId ?? null
        const issuedAt = cert.issuedAt.toISOString()
        const expiresAt = cert.expiresAt.toISOString()
        return withErr(
          sql`INSERT INTO user_certificates (id, invite_id, user_id, username, email, serial_number, issued_at, expires_at)
              VALUES (${id}, ${inviteId}, ${userId}, ${cert.username}, ${cert.email}, ${cert.serialNumber}, ${issuedAt}, ${expiresAt})`.pipe(
            Effect.asVoid,
          ),
          "Failed to store certificate",
        )
      },

      listValid: (username: string) =>
        withErr(
          sql`SELECT * FROM user_certificates
              WHERE username = ${username} AND revoked_at IS NULL AND expires_at > NOW()
              ORDER BY issued_at DESC`.pipe(Effect.map((rows) => rows.map(toRow))),
          "Failed to list valid certificates",
        ),

      listAllByUsernames: (usernames: string[]) =>
        withErr(
          Effect.gen(function* () {
            if (usernames.length === 0) return {}
            const rows = yield* sql`SELECT * FROM user_certificates
                                    WHERE username IN ${sql.in(usernames)}
                                    ORDER BY issued_at DESC`
            const result: Record<string, UserCertificate[]> = {}
            for (const r of rows) {
              const cert = toRow(r)
              if (!result[cert.username]) result[cert.username] = []
              result[cert.username].push(cert)
            }
            return result
          }),
          "Failed to list certificates by usernames",
        ),

      findBySerial: (serialNumber: string) =>
        withErr(
          sql`SELECT * FROM user_certificates WHERE serial_number = ${serialNumber}`.pipe(
            Effect.map((rows) => (rows[0] ? toRow(rows[0]) : null)),
          ),
          "Failed to find certificate by serial",
        ),

      markRevokePending: (serialNumber: string, username?: string) =>
        withErr(
          username
            ? sql`UPDATE user_certificates SET revoke_state = 'pending'
                  WHERE serial_number = ${serialNumber} AND username = ${username} AND revoked_at IS NULL`.pipe(
                Effect.map((rows) => (rows as any).count ?? (rows as any).changes ?? 0),
              )
            : sql`UPDATE user_certificates SET revoke_state = 'pending'
                  WHERE serial_number = ${serialNumber} AND revoked_at IS NULL`.pipe(
                Effect.map((rows) => (rows as any).count ?? (rows as any).changes ?? 0),
              ),
          "Failed to mark certificate as revoke-pending",
        ),

      markRevokeCompleted: (serialNumber: string) =>
        withErr(
          sql`UPDATE user_certificates SET revoked_at = NOW(), revoke_state = 'completed', revoke_error = NULL
              WHERE serial_number = ${serialNumber}`.pipe(Effect.asVoid),
          "Failed to mark certificate as revoke-completed",
        ),

      markRevokeFailed: (serialNumber: string, error: string) =>
        withErr(
          sql`UPDATE user_certificates SET revoke_state = 'failed', revoke_error = ${error}
              WHERE serial_number = ${serialNumber}`.pipe(Effect.asVoid),
          "Failed to mark certificate as revoke-failed",
        ),

      revokeAllForUser: (username: string) =>
        withErr(
          Effect.gen(function* () {
            const active = yield* sql`SELECT serial_number FROM user_certificates
                            WHERE username = ${username} AND revoked_at IS NULL AND expires_at > NOW()`
            const serials = active.map((r: any) => r.serialNumber as string)
            if (serials.length > 0) {
              yield* sql`UPDATE user_certificates SET revoke_state = 'pending'
                        WHERE username = ${username} AND revoked_at IS NULL`
            }
            return serials
          }),
          "Failed to revoke all certificates for user",
        ),

      setUserId: (inviteId: string, userId: string) =>
        withErr(
          sql`UPDATE user_certificates SET user_id = ${userId} WHERE invite_id = ${inviteId}`.pipe(Effect.asVoid),
          "Failed to set user ID on certificate",
        ),

      updateUsername: (oldUsername: string, newUsername: string) =>
        withErr(
          sql`UPDATE user_certificates SET username = ${newUsername} WHERE username = ${oldUsername}`.pipe(
            Effect.asVoid,
          ),
          "Failed to update username on certificates",
        ),
    }
  }),
)
