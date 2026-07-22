import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

/**
 * Per-user display preferences: the IANA timezone and the clock format
 * (12h/24h) used to render the timestamps the app shows (request dates, cert
 * expiry, …). Both stay NULL until the user picks one; renderers fall back to
 * the browser's timezone and the locale's default clock, so existing rows keep
 * their current behaviour.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS timezone TEXT`
  yield* sql`ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS time_format TEXT`
})
