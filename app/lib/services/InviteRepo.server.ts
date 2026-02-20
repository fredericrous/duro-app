import { Context, Effect, Data, Layer, Schema } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import * as SqlError from "@effect/sql/SqlError"
import * as crypto from "node:crypto"
import { hashToken } from "~/lib/crypto.server"
import { MigrationsRan, currentDialect } from "~/lib/db/client.server"

const now = () => new Date().toISOString()
const addDays = (days: number) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString()
}
const TRUE = currentDialect === "sqlite" ? 1 : true
const FALSE = currentDialect === "sqlite" ? 0 : false

export interface Invite {
  id: string
  token: string
  tokenHash: string
  email: string
  groups: string
  groupNames: string
  invitedBy: string
  createdAt: string
  expiresAt: string
  usedAt: string | null
  usedBy: string | null
  certIssued: boolean
  prCreated: boolean
  prNumber: number | null
  prMerged: boolean
  emailSent: boolean
  attempts: number
  lastAttemptAt: string | null
  reconcileAttempts: number
  lastReconcileAt: string | null
  lastError: string | null
  failedAt: string | null
  certUsername: string | null
  certVerified: boolean
  certVerifiedAt: string | null
  revertPrNumber: number | null
  revertPrMerged: boolean
  locale: string
}

export interface Revocation {
  id: string
  email: string
  username: string
  reason: string | null
  revokedAt: string
  revokedBy: string
}

export class InviteError extends Data.TaggedError("InviteError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class InviteRepo extends Context.Tag("InviteRepo")<
  InviteRepo,
  {
    readonly create: (input: {
      email: string
      groups: number[]
      groupNames: string[]
      invitedBy: string
      locale?: string
    }) => Effect.Effect<{ id: string; token: string }, InviteError>
    readonly findByTokenHash: (tokenHash: string) => Effect.Effect<Invite | null, InviteError>
    readonly consumeByToken: (rawToken: string) => Effect.Effect<Invite, InviteError>
    readonly markUsedBy: (id: string, username: string) => Effect.Effect<void, InviteError>
    readonly findPending: () => Effect.Effect<Invite[], InviteError>
    readonly incrementAttempt: (tokenHash: string) => Effect.Effect<void, InviteError>
    readonly markCertIssued: (id: string) => Effect.Effect<void, InviteError>
    readonly markPRCreated: (id: string, prNumber: number) => Effect.Effect<void, InviteError>
    readonly markPRMerged: (id: string) => Effect.Effect<void, InviteError>
    readonly markEmailSent: (id: string) => Effect.Effect<void, InviteError>
    readonly findAwaitingMerge: () => Effect.Effect<Invite[], InviteError>
    readonly revoke: (id: string) => Effect.Effect<void, InviteError>
    readonly deleteById: (id: string) => Effect.Effect<void, InviteError>
    readonly findById: (id: string) => Effect.Effect<Invite | null, InviteError>
    readonly recordReconcileError: (id: string, error: string) => Effect.Effect<void, InviteError>
    readonly markFailed: (id: string, error: string) => Effect.Effect<void, InviteError>
    readonly clearReconcileError: (id: string) => Effect.Effect<void, InviteError>
    readonly findFailed: () => Effect.Effect<Invite[], InviteError>
    readonly setCertUsername: (id: string, username: string) => Effect.Effect<void, InviteError>
    readonly markCertVerified: (id: string) => Effect.Effect<void, InviteError>
    readonly findAwaitingCertVerification: () => Effect.Effect<Invite[], InviteError>
    readonly markRevoking: (id: string) => Effect.Effect<void, InviteError>
    readonly markRevertPRCreated: (id: string, prNumber: number) => Effect.Effect<void, InviteError>
    readonly markRevertPRMerged: (id: string) => Effect.Effect<void, InviteError>
    readonly findAwaitingRevertMerge: () => Effect.Effect<Invite[], InviteError>
    readonly recordRevocation: (
      email: string,
      username: string,
      revokedBy: string,
      reason?: string,
    ) => Effect.Effect<void, InviteError>
    readonly findRevocations: () => Effect.Effect<Revocation[], InviteError>
    readonly deleteRevocation: (id: string) => Effect.Effect<void, InviteError>
    readonly findRevocationByEmail: (email: string) => Effect.Effect<Revocation | null, InviteError>
  }
>() {}

const Coerced = {
  Boolean: Schema.transform(Schema.Unknown, Schema.Boolean, {
    decode: (v) => !!v,
    encode: (v) => v,
  }),
  NullableString: Schema.NullOr(Schema.String),
  NullableNumber: Schema.NullOr(Schema.Number),
  DateString: Schema.transform(Schema.Unknown, Schema.String, {
    decode: (v) => (v instanceof Date ? v.toISOString() : String(v)),
    encode: (v) => v,
  }),
  NullableDateString: Schema.transform(Schema.Unknown, Schema.NullOr(Schema.String), {
    decode: (v) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v)),
    encode: (v) => v,
  }),
}

const InviteRow = Schema.Struct({
  id: Schema.String,
  token: Schema.String,
  tokenHash: Schema.String,
  email: Schema.String,
  groups: Schema.String,
  groupNames: Schema.String,
  invitedBy: Schema.String,
  createdAt: Coerced.DateString,
  expiresAt: Coerced.DateString,
  usedAt: Coerced.NullableDateString,
  usedBy: Coerced.NullableString,
  certIssued: Coerced.Boolean,
  prCreated: Coerced.Boolean,
  prNumber: Coerced.NullableNumber,
  prMerged: Coerced.Boolean,
  emailSent: Coerced.Boolean,
  attempts: Schema.optionalWith(Schema.Number, { default: () => 0 }),
  lastAttemptAt: Coerced.NullableDateString,
  reconcileAttempts: Schema.optionalWith(Schema.Number, { default: () => 0 }),
  lastReconcileAt: Coerced.NullableDateString,
  lastError: Coerced.NullableString,
  failedAt: Coerced.NullableDateString,
  certUsername: Coerced.NullableString,
  certVerified: Coerced.Boolean,
  certVerifiedAt: Coerced.NullableDateString,
  revertPrNumber: Coerced.NullableNumber,
  revertPrMerged: Coerced.Boolean,
  locale: Schema.optionalWith(Schema.String, { default: () => "en" }),
})

const decodeInviteRow = Schema.decodeUnknownSync(InviteRow)

function rowToInvite(row: unknown): Invite {
  return decodeInviteRow(row) as Invite
}

const RevocationRow = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  username: Schema.String,
  reason: Coerced.NullableString,
  revokedAt: Coerced.DateString,
  revokedBy: Schema.String,
})

const decodeRevocationRow = Schema.decodeUnknownSync(RevocationRow)

function rowToRevocation(row: unknown): Revocation {
  return decodeRevocationRow(row) as Revocation
}

const withErr = <A>(effect: Effect.Effect<A, SqlError.SqlError>, message: string) =>
  effect.pipe(Effect.mapError((e) => new InviteError({ message, cause: e })))

export const InviteRepoLive = Layer.effect(
  InviteRepo,
  Effect.gen(function* () {
    yield* MigrationsRan
    const sql = yield* SqlClient.SqlClient

    return {
      create: (input) =>
        Effect.gen(function* () {
          const ts = now()
          const expires = addDays(7)

          const existing = yield* withErr(
            sql`SELECT id FROM invites WHERE email = ${input.email} AND used_at IS NULL AND expires_at > ${ts}`,
            "Failed to check existing invite",
          )
          if (existing.length > 0) {
            return yield* new InviteError({
              message: `Pending invite already exists for ${input.email}`,
            })
          }

          const id = crypto.randomUUID()
          const token = crypto.randomBytes(32).toString("base64url")
          const tokenHash = hashToken(token)

          const locale = input.locale ?? "en"
          yield* withErr(
            sql`INSERT INTO invites (id, token, token_hash, email, groups, group_names, invited_by, created_at, expires_at, locale)
                VALUES (${id}, ${token}, ${tokenHash}, ${input.email}, ${JSON.stringify(input.groups)}, ${JSON.stringify(input.groupNames)}, ${input.invitedBy}, ${ts}, ${expires}, ${locale})`,
            "Failed to create invite",
          )

          return { id, token }
        }),

      findByTokenHash: (tokenHash) =>
        withErr(
          sql`SELECT * FROM invites WHERE token_hash = ${tokenHash}`.pipe(
            Effect.map((rows) => (rows.length > 0 ? rowToInvite(rows[0]) : null)),
          ),
          "Failed to find invite",
        ),

      consumeByToken: (rawToken) =>
        Effect.gen(function* () {
          const ts = now()
          const tokenHash = hashToken(rawToken)
          const rows = yield* withErr(
            sql`UPDATE invites SET used_at = ${ts}
                WHERE token_hash = ${tokenHash} AND used_at IS NULL AND expires_at > ${ts}
                RETURNING *`,
            "Failed to consume invite",
          )

          if (rows.length === 0) {
            return yield* new InviteError({
              message: "Invite is invalid, expired, or already used",
            })
          }

          return rowToInvite(rows[0])
        }),

      markUsedBy: (id, username) =>
        withErr(
          sql`UPDATE invites SET used_by = ${username} WHERE id = ${id}`.pipe(Effect.asVoid),
          "Failed to mark invite as used",
        ),

      findPending: () =>
        withErr(
          sql`SELECT * FROM invites WHERE used_at IS NULL AND expires_at > ${now()} ORDER BY created_at DESC`.pipe(
            Effect.map((rows) => rows.map(rowToInvite)),
          ),
          "Failed to find pending invites",
        ),

      incrementAttempt: (tokenHash) =>
        withErr(
          sql`UPDATE invites SET attempts = attempts + 1, last_attempt_at = ${now()} WHERE token_hash = ${tokenHash}`.pipe(
            Effect.asVoid,
          ),
          "Failed to increment attempt",
        ),

      markCertIssued: (id) =>
        withErr(
          sql`UPDATE invites SET cert_issued = ${TRUE} WHERE id = ${id}`.pipe(Effect.asVoid),
          "Failed to mark cert issued",
        ),

      markPRCreated: (id, prNumber) =>
        withErr(
          sql`UPDATE invites SET pr_created = ${TRUE}, pr_number = ${prNumber} WHERE id = ${id}`.pipe(Effect.asVoid),
          "Failed to mark PR created",
        ),

      markPRMerged: (id) =>
        withErr(
          sql`UPDATE invites SET pr_merged = ${TRUE} WHERE id = ${id}`.pipe(Effect.asVoid),
          "Failed to mark PR merged",
        ),

      markEmailSent: (id) =>
        withErr(
          sql`UPDATE invites SET email_sent = ${TRUE} WHERE id = ${id}`.pipe(Effect.asVoid),
          "Failed to mark email sent",
        ),

      findAwaitingMerge: () =>
        withErr(
          sql`SELECT * FROM invites
              WHERE pr_created = ${TRUE} AND email_sent = ${FALSE} AND pr_number IS NOT NULL AND used_at IS NULL AND failed_at IS NULL`.pipe(
            Effect.map((rows) => rows.map(rowToInvite)),
          ),
          "Failed to find invites awaiting merge",
        ),

      revoke: (id) =>
        Effect.gen(function* () {
          const rows = yield* withErr(
            sql`UPDATE invites SET used_at = ${now()}, used_by = '__revoked__'
                WHERE id = ${id} AND used_at IS NULL
                RETURNING id`,
            "Failed to revoke invite",
          )
          if (rows.length === 0) {
            return yield* new InviteError({
              message: "Invite not found or already used",
            })
          }
        }),

      deleteById: (id) =>
        withErr(sql`DELETE FROM invites WHERE id = ${id}`.pipe(Effect.asVoid), "Failed to delete invite"),

      findById: (id) =>
        withErr(
          sql`SELECT * FROM invites WHERE id = ${id}`.pipe(
            Effect.map((rows) => (rows.length > 0 ? rowToInvite(rows[0]) : null)),
          ),
          "Failed to find invite",
        ),

      recordReconcileError: (id, error) =>
        withErr(
          sql`UPDATE invites SET reconcile_attempts = reconcile_attempts + 1, last_reconcile_at = ${now()}, last_error = ${error} WHERE id = ${id}`.pipe(
            Effect.asVoid,
          ),
          "Failed to record reconcile error",
        ),

      markFailed: (id, error) =>
        withErr(
          sql`UPDATE invites SET failed_at = ${now()}, last_error = ${error} WHERE id = ${id}`.pipe(Effect.asVoid),
          "Failed to mark invite as failed",
        ),

      clearReconcileError: (id) =>
        withErr(
          sql`UPDATE invites SET reconcile_attempts = 0, last_reconcile_at = NULL, last_error = NULL, failed_at = NULL WHERE id = ${id}`.pipe(
            Effect.asVoid,
          ),
          "Failed to clear reconcile error",
        ),

      findFailed: () =>
        withErr(
          sql`SELECT * FROM invites WHERE failed_at IS NOT NULL AND used_at IS NULL ORDER BY failed_at DESC`.pipe(
            Effect.map((rows) => rows.map(rowToInvite)),
          ),
          "Failed to find failed invites",
        ),

      setCertUsername: (id, username) =>
        withErr(
          sql`UPDATE invites SET cert_username = ${username} WHERE id = ${id}`.pipe(Effect.asVoid),
          "Failed to set cert username",
        ),

      markCertVerified: (id) =>
        withErr(
          sql`UPDATE invites SET cert_verified = ${TRUE}, cert_verified_at = ${now()} WHERE id = ${id}`.pipe(
            Effect.asVoid,
          ),
          "Failed to mark cert verified",
        ),

      findAwaitingCertVerification: () =>
        withErr(
          sql`SELECT * FROM invites WHERE email_sent = ${TRUE} AND cert_verified = ${FALSE} AND cert_username IS NOT NULL AND used_at IS NULL AND failed_at IS NULL`.pipe(
            Effect.map((rows) => rows.map(rowToInvite)),
          ),
          "Failed to find invites awaiting cert verification",
        ),

      markRevoking: (id) =>
        withErr(
          sql`UPDATE invites SET used_at = ${now()}, used_by = '__revoking__' WHERE id = ${id}`.pipe(Effect.asVoid),
          "Failed to mark invite as revoking",
        ),

      markRevertPRCreated: (id, prNumber) =>
        withErr(
          sql`UPDATE invites SET revert_pr_number = ${prNumber} WHERE id = ${id}`.pipe(Effect.asVoid),
          "Failed to mark revert PR created",
        ),

      markRevertPRMerged: (id) =>
        withErr(
          sql`UPDATE invites SET revert_pr_merged = ${TRUE}, used_by = '__revoked__' WHERE id = ${id}`.pipe(
            Effect.asVoid,
          ),
          "Failed to mark revert PR merged",
        ),

      findAwaitingRevertMerge: () =>
        withErr(
          sql`SELECT * FROM invites WHERE used_by = '__revoking__' AND revert_pr_number IS NOT NULL AND revert_pr_merged = ${FALSE}`.pipe(
            Effect.map((rows) => rows.map(rowToInvite)),
          ),
          "Failed to find invites awaiting revert merge",
        ),

      recordRevocation: (email, username, revokedBy, reason?) =>
        withErr(
          sql`INSERT INTO user_revocations (id, email, username, reason, revoked_by)
              VALUES (${crypto.randomUUID()}, ${email}, ${username}, ${reason ?? null}, ${revokedBy})`.pipe(
            Effect.asVoid,
          ),
          "Failed to record revocation",
        ),

      findRevocations: () =>
        withErr(
          sql`SELECT * FROM user_revocations ORDER BY revoked_at DESC`.pipe(
            Effect.map((rows) => rows.map(rowToRevocation)),
          ),
          "Failed to find revocations",
        ),

      deleteRevocation: (id) =>
        withErr(sql`DELETE FROM user_revocations WHERE id = ${id}`.pipe(Effect.asVoid), "Failed to delete revocation"),

      findRevocationByEmail: (email) =>
        withErr(
          sql`SELECT * FROM user_revocations WHERE email = ${email}`.pipe(
            Effect.map((rows) => (rows.length > 0 ? rowToRevocation(rows[0]) : null)),
          ),
          "Failed to find revocation by email",
        ),
    }
  }),
)
