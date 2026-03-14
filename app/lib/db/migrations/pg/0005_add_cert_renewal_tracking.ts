import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS last_cert_renewal_at TIMESTAMPTZ`
  yield* sql`ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS cert_renewal_id TEXT`
})
