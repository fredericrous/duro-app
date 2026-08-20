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
  /** User-supplied device name; null until set (shown as "Unnamed device"). */
  label: string | null
  /** UA-derived device kind captured at claim time (e.g. "iPhone", "Mac").
   *  Survives renames — the label is the pet name, this is what it IS. */
  claimedPlatform: string | null
  serialNumber: string
  issuedAt: string
  expiresAt: string
  revokedAt: string | null
  revokeState: string | null
  revokeError: string | null
  /** Serial of the cert this one replaces; null unless issued by a renewal. */
  renewedFromSerial: string | null
}

export interface StoreCertInput {
  inviteId?: string | null
  userId?: string | null
  username: string
  email: string
  label?: string | null
  serialNumber: string
  issuedAt: Date
  expiresAt: Date
  renewedFromSerial?: string | null
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
    /** Set/clear a cert's device label. Ownership-enforced. Returns affected row count. */
    /** Record the claiming device's kind, once — set-if-null so a later page
     *  reload can't overwrite what the first claim observed. Token-authed
     *  callers scope by serial (no username check: the reveal row is the
     *  authority on ownership). */
    readonly setClaimedPlatform: (serialNumber: string, platform: string) => Effect.Effect<void, CertificateRepoError>
    readonly setLabel: (
      serialNumber: string,
      username: string,
      label: string | null,
    ) => Effect.Effect<number, CertificateRepoError>
    readonly listValid: (username: string) => Effect.Effect<UserCertificate[], CertificateRepoError>
    /**
     * Every non-revoked cert, INCLUDING expired ones — an expired device still
     * has to be visible so its owner can renew it (listValid hides those).
     */
    readonly listUnrevoked: (username: string) => Effect.Effect<UserCertificate[], CertificateRepoError>
    /**
     * Live NEW-device certs issued since `since`, oldest first. This IS the
     * daily device budget: the certificates themselves are the ledger, so a
     * revoked one stops counting the moment it is revoked, and a renewal
     * (which replaces a device rather than adding one) never counts at all.
     */
    readonly listRecentNewDevices: (
      username: string,
      since: Date,
    ) => Effect.Effect<UserCertificate[], CertificateRepoError>
    /**
     * Newest cert issued as a replacement for `serialNumber`. The renewal
     * cooldown is derived from its issued_at.
     */
    readonly findLatestRenewalOf: (serialNumber: string) => Effect.Effect<UserCertificate | null, CertificateRepoError>
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
  label: r.label ?? null,
  claimedPlatform: r.claimedPlatform ?? null,
  serialNumber: r.serialNumber,
  issuedAt: r.issuedAt,
  expiresAt: r.expiresAt,
  revokedAt: r.revokedAt ?? null,
  revokeState: r.revokeState ?? null,
  revokeError: r.revokeError ?? null,
  renewedFromSerial: r.renewedFromSerial ?? null,
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
        const label = cert.label ?? null
        const issuedAt = cert.issuedAt.toISOString()
        const expiresAt = cert.expiresAt.toISOString()
        const renewedFromSerial = cert.renewedFromSerial ?? null
        return withErr(
          sql`INSERT INTO user_certificates (id, invite_id, user_id, username, email, label, serial_number, issued_at, expires_at, renewed_from_serial)
              VALUES (${id}, ${inviteId}, ${userId}, ${cert.username}, ${cert.email}, ${label}, ${cert.serialNumber}, ${issuedAt}, ${expiresAt}, ${renewedFromSerial})`.pipe(
            Effect.asVoid,
          ),
          "Failed to store certificate",
        )
      },

      setClaimedPlatform: (serialNumber: string, platform: string) =>
        withErr(
          // Set-if-null: the first claim observation wins; reloads and later
          // visits to the claim page can't rewrite history.
          sql`UPDATE user_certificates SET claimed_platform = ${platform}
              WHERE serial_number = ${serialNumber} AND claimed_platform IS NULL`.pipe(Effect.asVoid),
          "Failed to set certificate claimed platform",
        ),

      setLabel: (serialNumber: string, username: string, label: string | null) =>
        withErr(
          // RETURNING + rows.length is driver-agnostic (the bare affected-count
          // property differs between pg and PGlite); ownership enforced via username.
          sql`UPDATE user_certificates SET label = ${label}
              WHERE serial_number = ${serialNumber} AND username = ${username} AND revoked_at IS NULL
              RETURNING serial_number`.pipe(Effect.map((rows) => rows.length)),
          "Failed to set certificate label",
        ),

      listValid: (username: string) =>
        withErr(
          sql`SELECT * FROM user_certificates
              WHERE username = ${username} AND revoked_at IS NULL AND expires_at > NOW()
              ORDER BY issued_at DESC`.pipe(Effect.map((rows) => rows.map(toRow))),
          "Failed to list valid certificates",
        ),

      listRecentNewDevices: (username: string, since: Date) =>
        withErr(
          sql`SELECT * FROM user_certificates
              WHERE username = ${username}
                AND revoked_at IS NULL
                AND renewed_from_serial IS NULL
                AND issued_at > ${since.toISOString()}
              ORDER BY issued_at ASC`.pipe(Effect.map((rows) => rows.map(toRow))),
          "Failed to list recent new devices",
        ),

      listUnrevoked: (username: string) =>
        withErr(
          sql`SELECT * FROM user_certificates
              WHERE username = ${username} AND revoked_at IS NULL
              ORDER BY issued_at DESC`.pipe(Effect.map((rows) => rows.map(toRow))),
          "Failed to list unrevoked certificates",
        ),

      findLatestRenewalOf: (serialNumber: string) =>
        withErr(
          // Revoked successors count too: otherwise "renew, revoke the new one,
          // renew again" is an unbounded bypass of the renewal rate limit.
          sql`SELECT * FROM user_certificates
              WHERE renewed_from_serial = ${serialNumber}
              ORDER BY issued_at DESC LIMIT 1`.pipe(Effect.map((rows) => (rows[0] ? toRow(rows[0]) : null))),
          "Failed to find latest renewal",
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
          // RETURNING + rows.length, same as setLabel: the bare affected-count
          // property differs between pg and PGlite and read as 0 on both here,
          // which made every ownership-checked revoke report "not found".
          username
            ? sql`UPDATE user_certificates SET revoke_state = 'pending'
                  WHERE serial_number = ${serialNumber} AND username = ${username} AND revoked_at IS NULL
                  RETURNING serial_number`.pipe(Effect.map((rows) => rows.length))
            : sql`UPDATE user_certificates SET revoke_state = 'pending'
                  WHERE serial_number = ${serialNumber} AND revoked_at IS NULL
                  RETURNING serial_number`.pipe(Effect.map((rows) => rows.length)),
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
