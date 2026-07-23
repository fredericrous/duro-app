import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

/**
 * Per-user theme choice (dark/light). NULL means "no explicit choice" →
 * renderers fall back to the default theme. The SSR-visible source is a cookie
 * (see theme.server.ts); this column is the durable, cross-device store.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS theme TEXT`
})
