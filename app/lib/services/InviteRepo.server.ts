import { Context, Effect, Data, Layer } from "effect"
import * as crypto from "node:crypto"
import Database from "better-sqlite3"
import { hashToken } from "~/lib/crypto.server"

export interface Invite {
  id: string
  tokenHash: string
  email: string
  groups: string
  groupNames: string
  invitedBy: string
  createdAt: string
  expiresAt: string
  usedAt: string | null
  usedBy: string | null
  stepState: string
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
    readonly updateStepState: (
      id: string,
      patch: Record<string, boolean>,
    ) => Effect.Effect<void, InviteError>
    readonly revoke: (id: string) => Effect.Effect<void, InviteError>
    readonly deleteById: (id: string) => Effect.Effect<void, InviteError>
    readonly findById: (id: string) => Effect.Effect<Invite | null, InviteError>
  }
>() {}

interface InviteRow {
  id: string
  token_hash: string
  email: string
  groups: string
  group_names: string
  invited_by: string
  created_at: string
  expires_at: string
  used_at: string | null
  used_by: string | null
  step_state: string
  attempts: number
  last_attempt_at: string | null
}

function rowToInvite(row: InviteRow): Invite {
  return {
    id: row.id,
    tokenHash: row.token_hash,
    email: row.email,
    groups: row.groups,
    groupNames: row.group_names,
    invitedBy: row.invited_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    usedBy: row.used_by,
    stepState: row.step_state,
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
        token_hash TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL,
        groups TEXT NOT NULL,
        group_names TEXT NOT NULL,
        invited_by TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL,
        used_at TEXT,
        used_by TEXT,
        step_state TEXT NOT NULL DEFAULT '{}',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT
      )
    `)

    const stmts = {
      insert: db.prepare(`
        INSERT INTO invites (id, token_hash, email, groups, group_names, invited_by, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+48 hours'))
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
      getStepState: db.prepare(`SELECT step_state FROM invites WHERE id = ?`),
      updateStepState: db.prepare(
        `UPDATE invites SET step_state = ? WHERE id = ?`,
      ),
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
            // Check for existing pending invite
            const existing = stmts.findPendingByEmail.get(input.email) as
              | Invite
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

      updateStepState: (id, patch) =>
        Effect.try({
          try: () => {
            const row = stmts.getStepState.get(id) as
              | { step_state: string }
              | undefined
            const current = row ? JSON.parse(row.step_state) : {}
            const updated = { ...current, ...patch }
            stmts.updateStepState.run(JSON.stringify(updated), id)
          },
          catch: (e) =>
            new InviteError({
              message: "Failed to update step state",
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
