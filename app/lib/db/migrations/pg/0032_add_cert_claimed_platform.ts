import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

/**
 * What KIND of device claimed this certificate, derived server-side from the
 * claim request's User-Agent (the device opening /cert/:token IS the device).
 * Deliberately separate from `label`: the label is the user's editable pet
 * name; this column survives renames so "Bob's phone" is still knowably an
 * iPhone. Nullable — set at claim time, absent for certs claimed before this
 * column or from unrecognisable agents.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE user_certificates ADD COLUMN IF NOT EXISTS claimed_platform TEXT`
})
