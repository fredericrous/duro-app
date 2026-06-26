import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

/**
 * Optional user-supplied device name for a certificate ("MacBook Pro",
 * "iPhone"). Certs are mTLS client certs and carry no device identity, so the
 * label is the only human-friendly way to tell one device's cert from another
 * in the settings list. Existing rows stay NULL (shown as "Unnamed device"
 * until the owner renames them).
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE user_certificates ADD COLUMN IF NOT EXISTS label TEXT`
})
