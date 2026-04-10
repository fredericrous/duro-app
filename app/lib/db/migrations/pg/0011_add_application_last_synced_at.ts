import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ`
})
