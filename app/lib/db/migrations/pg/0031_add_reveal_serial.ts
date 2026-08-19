import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

/**
 * The QR/claim-time-naming flow needs the reveal token to know WHICH
 * certificate it belongs to, so the claim page can set the device label on
 * the right cert record. Nullable: rows minted before this migration have no
 * serial and the claim page simply doesn't offer naming for them.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE cert_reveal_tokens ADD COLUMN IF NOT EXISTS serial_number TEXT`
})
