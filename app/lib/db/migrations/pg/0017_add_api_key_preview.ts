import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

/**
 * Add key_preview to api_keys so the settings UI can match "the key in my
 * .mcp.json" against "the row in this table". We can't recover the raw key
 * from key_hash, so we store a short prefix+suffix at mint time. Existing
 * rows stay NULL — the UI renders them as "—".
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key_preview TEXT`
})
