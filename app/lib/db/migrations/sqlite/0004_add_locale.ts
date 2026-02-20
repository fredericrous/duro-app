import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE invites ADD COLUMN locale TEXT NOT NULL DEFAULT 'en'`
  yield* sql`
    CREATE TABLE IF NOT EXISTS user_preferences (
      username TEXT PRIMARY KEY,
      locale TEXT NOT NULL DEFAULT 'en',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `
})
