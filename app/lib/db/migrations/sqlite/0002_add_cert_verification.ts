import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE invites ADD COLUMN cert_username TEXT`
  yield* sql`ALTER TABLE invites ADD COLUMN cert_verified INTEGER NOT NULL DEFAULT 0`
  yield* sql`ALTER TABLE invites ADD COLUMN cert_verified_at TEXT`
})
