import { Context, Effect, Data, Layer } from "effect"
import * as crypto from "node:crypto"
import Database from "better-sqlite3"
import { hashToken } from "~/lib/crypto.server"

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
    }) => Effect.Effect<{ id: string; token: string }, InviteError>
    readonly findByTokenHash: (
      tokenHash: string,
    ) => Effect.Effect<Invite | null, InviteError>
    readonly consumeByToken: (
      rawToken: string,
    ) => Effect.Effect<Invite, InviteError>
    readonly markUsedBy: (
      id: string,
      username: string,
    ) => Effect.Effect<void, InviteError>
    readonly findPending: () => Effect.Effect<Invite[], InviteError>
    readonly incrementAttempt: (
      tokenHash: string,
    ) => Effect.Effect<void, InviteError>
    readonly markCertIssued: (id: string) => Effect.Effect<void, InviteError>
    readonly markPRCreated: (
      id: string,
      prNumber: number,
    ) => Effect.Effect<void, InviteError>
    readonly markPRMerged: (id: string) => Effect.Effect<void, InviteError>
    readonly markEmailSent: (id: string) => Effect.Effect<void, InviteError>
    readonly findAwaitingMerge: () => Effect.Effect<Invite[], InviteError>
    readonly revoke: (id: string) => Effect.Effect<void, InviteError>
    readonly deleteById: (id: string) => Effect.Effect<void, InviteError>
    readonly findById: (id: string) => Effect.Effect<Invite | null, InviteError>
  }
>() {}

interface InviteRow {
  id: string
  token: string
  token_hash: string
  email: string
  groups: string
  group_names: string
  invited_by: string
  created_at: string
  expires_at: string
  used_at: string | null
  used_by: string | null
  cert_issued: number
  pr_created: number
  pr_number: number | null
  pr_merged: number
  email_sent: number
  attempts: number
  last_attempt_at: string | null
}

function rowToInvite(row: InviteRow): Invite {
  return {
    id: row.id,
    token: row.token,
    tokenHash: row.token_hash,
    email: row.email,
    groups: row.groups,
    groupNames: row.group_names,
    invitedBy: row.invited_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    usedBy: row.used_by,
    certIssued: !!row.cert_issued,
    prCreated: !!row.pr_created,
    prNumber: row.pr_number ?? null,
    prMerged: !!row.pr_merged,
    emailSent: !!row.email_sent,
    attempts: row.attempts,
    lastAttemptAt: row.last_attempt_at,
  }
}

export const InviteRepoLive = Layer.effect(
  InviteRepo,
  Effect.sync(() => {
    const dbPath = process.env.DURO_DB_PATH ?? "/db/duro.sqlite"
    const db = new Database(dbPath)

    db.pragma("journal_mode = WAL")
    db.pragma("busy_timeout = 5000")

    db.exec(`
      CREATE TABLE IF NOT EXISTS invites (
        id TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL,
        groups TEXT NOT NULL,
        group_names TEXT NOT NULL,
        invited_by TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL,
        used_at TEXT,
        used_by TEXT,
        cert_issued INTEGER NOT NULL DEFAULT 0,
        pr_created INTEGER NOT NULL DEFAULT 0,
        pr_number INTEGER,
        pr_merged INTEGER NOT NULL DEFAULT 0,
        email_sent INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT
      )
    `)

    const stmts = {
      insert: db.prepare(`
        INSERT INTO invites (id, token, token_hash, email, groups, group_names, invited_by, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+48 hours'))
      `),
      findByHash: db.prepare(
        `SELECT * FROM invites WHERE token_hash = ?`,
      ),
      consume: db.prepare(`
        UPDATE invites SET used_at = datetime('now')
        WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')
      `),
      markUsedBy: db.prepare(
        `UPDATE invites SET used_by = ? WHERE id = ?`,
      ),
      findPending: db.prepare(`
        SELECT * FROM invites WHERE used_at IS NULL AND expires_at > datetime('now')
        ORDER BY created_at DESC
      `),
      incrementAttempt: db.prepare(`
        UPDATE invites SET attempts = attempts + 1, last_attempt_at = datetime('now')
        WHERE token_hash = ?
      `),
      markCertIssued: db.prepare(
        `UPDATE invites SET cert_issued = 1 WHERE id = ?`,
      ),
      markPRCreated: db.prepare(
        `UPDATE invites SET pr_created = 1, pr_number = ? WHERE id = ?`,
      ),
      markPRMerged: db.prepare(
        `UPDATE invites SET pr_merged = 1 WHERE id = ?`,
      ),
      markEmailSent: db.prepare(
        `UPDATE invites SET email_sent = 1 WHERE id = ?`,
      ),
      findAwaitingMerge: db.prepare(`
        SELECT * FROM invites
        WHERE pr_created = 1 AND email_sent = 0 AND pr_number IS NOT NULL AND used_at IS NULL
      `),
      findPendingByEmail: db.prepare(`
        SELECT * FROM invites WHERE email = ? AND used_at IS NULL AND expires_at > datetime('now')
      `),
      revoke: db.prepare(`
        UPDATE invites SET used_at = datetime('now'), used_by = '__revoked__'
        WHERE id = ? AND used_at IS NULL
      `),
      deleteById: db.prepare(`DELETE FROM invites WHERE id = ?`),
      findById: db.prepare(`SELECT * FROM invites WHERE id = ?`),
    }

    return {
      create: (input) =>
        Effect.try({
          try: () => {
            const existing = stmts.findPendingByEmail.get(input.email) as
              | InviteRow
              | undefined
            if (existing) {
              throw new InviteError({
                message: `Pending invite already exists for ${input.email}`,
              })
            }

            const id = crypto.randomUUID()
            const token = crypto.randomBytes(32).toString("base64url")
            const tokenHash = hashToken(token)

            stmts.insert.run(
              id,
              token,
              tokenHash,
              input.email,
              JSON.stringify(input.groups),
              JSON.stringify(input.groupNames),
              input.invitedBy,
            )

            return { id, token }
          },
          catch: (e) => {
            if (e instanceof InviteError) return e
            return new InviteError({
              message: "Failed to create invite",
              cause: e,
            })
          },
        }),

      findByTokenHash: (tokenHash) =>
        Effect.try({
          try: () => {
            const row = stmts.findByHash.get(tokenHash) as InviteRow | undefined
            return row ? rowToInvite(row) : null
          },
          catch: (e) =>
            new InviteError({
              message: "Failed to find invite",
              cause: e,
            }),
        }),

      consumeByToken: (rawToken) =>
        Effect.gen(function* () {
          const tokenHash = hashToken(rawToken)
          const result = yield* Effect.try({
            try: () => stmts.consume.run(tokenHash),
            catch: (e) =>
              new InviteError({
                message: "Failed to consume invite",
                cause: e,
              }),
          })

          if (result.changes === 0) {
            return yield* new InviteError({
              message: "Invite is invalid, expired, or already used",
            })
          }

          const row = yield* Effect.try({
            try: () =>
              stmts.findByHash.get(tokenHash) as InviteRow,
            catch: (e) =>
              new InviteError({
                message: "Failed to find consumed invite",
                cause: e,
              }),
          })

          return rowToInvite(row)
        }),

      markUsedBy: (id, username) =>
        Effect.try({
          try: () => {
            stmts.markUsedBy.run(username, id)
          },
          catch: (e) =>
            new InviteError({
              message: "Failed to mark invite as used",
              cause: e,
            }),
        }),

      findPending: () =>
        Effect.try({
          try: () => {
            const rows = stmts.findPending.all() as InviteRow[]
            return rows.map(rowToInvite)
          },
          catch: (e) =>
            new InviteError({
              message: "Failed to find pending invites",
              cause: e,
            }),
        }),

      incrementAttempt: (tokenHash) =>
        Effect.try({
          try: () => {
            stmts.incrementAttempt.run(tokenHash)
          },
          catch: (e) =>
            new InviteError({
              message: "Failed to increment attempt",
              cause: e,
            }),
        }),

      markCertIssued: (id) =>
        Effect.try({
          try: () => {
            stmts.markCertIssued.run(id)
          },
          catch: (e) =>
            new InviteError({
              message: "Failed to mark cert issued",
              cause: e,
            }),
        }),

      markPRCreated: (id, prNumber) =>
        Effect.try({
          try: () => {
            stmts.markPRCreated.run(prNumber, id)
          },
          catch: (e) =>
            new InviteError({
              message: "Failed to mark PR created",
              cause: e,
            }),
        }),

      markPRMerged: (id) =>
        Effect.try({
          try: () => {
            stmts.markPRMerged.run(id)
          },
          catch: (e) =>
            new InviteError({
              message: "Failed to mark PR merged",
              cause: e,
            }),
        }),

      markEmailSent: (id) =>
        Effect.try({
          try: () => {
            stmts.markEmailSent.run(id)
          },
          catch: (e) =>
            new InviteError({
              message: "Failed to mark email sent",
              cause: e,
            }),
        }),

      findAwaitingMerge: () =>
        Effect.try({
          try: () => {
            const rows = stmts.findAwaitingMerge.all() as InviteRow[]
            return rows.map(rowToInvite)
          },
          catch: (e) =>
            new InviteError({
              message: "Failed to find invites awaiting merge",
              cause: e,
            }),
        }),

      revoke: (id) =>
        Effect.try({
          try: () => {
            const result = stmts.revoke.run(id)
            if (result.changes === 0) {
              throw new InviteError({
                message: "Invite not found or already used",
              })
            }
          },
          catch: (e) => {
            if (e instanceof InviteError) return e
            return new InviteError({
              message: "Failed to revoke invite",
              cause: e,
            })
          },
        }),

      deleteById: (id) =>
        Effect.try({
          try: () => {
            stmts.deleteById.run(id)
          },
          catch: (e) =>
            new InviteError({
              message: "Failed to delete invite",
              cause: e,
            }),
        }),

      findById: (id) =>
        Effect.try({
          try: () => {
            const row = stmts.findById.get(id) as InviteRow | undefined
            return row ? rowToInvite(row) : null
          },
          catch: (e) =>
            new InviteError({
              message: "Failed to find invite",
              cause: e,
            }),
        }),
    }
  }),
)
