import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE invites ADD COLUMN IF NOT EXISTS revert_pr_number INTEGER`
  yield* sql`ALTER TABLE invites ADD COLUMN IF NOT EXISTS revert_pr_merged BOOLEAN NOT NULL DEFAULT FALSE`
})
