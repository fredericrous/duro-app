import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    CREATE TABLE IF NOT EXISTS user_revocations (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      username TEXT NOT NULL,
      reason TEXT,
      revoked_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_by TEXT NOT NULL
    )
  `
  yield* sql`ALTER TABLE invites ADD COLUMN revert_pr_number INTEGER`
  yield* sql`ALTER TABLE invites ADD COLUMN revert_pr_merged INTEGER NOT NULL DEFAULT 0`
})
