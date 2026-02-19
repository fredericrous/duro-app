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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      used_by TEXT,
      cert_issued BOOLEAN NOT NULL DEFAULT FALSE,
      pr_created BOOLEAN NOT NULL DEFAULT FALSE,
      pr_number INTEGER,
      pr_merged BOOLEAN NOT NULL DEFAULT FALSE,
      email_sent BOOLEAN NOT NULL DEFAULT FALSE,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TIMESTAMPTZ,
      reconcile_attempts INTEGER NOT NULL DEFAULT 0,
      last_reconcile_at TIMESTAMPTZ,
      last_error TEXT,
      failed_at TIMESTAMPTZ,
      cert_username TEXT,
      cert_verified BOOLEAN NOT NULL DEFAULT FALSE,
      cert_verified_at TIMESTAMPTZ
    )
  `
})
