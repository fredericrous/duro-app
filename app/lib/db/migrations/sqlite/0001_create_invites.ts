import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
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
      last_attempt_at TEXT,
      reconcile_attempts INTEGER NOT NULL DEFAULT 0,
      last_reconcile_at TEXT,
      last_error TEXT,
      failed_at TEXT
    )
  `
})
