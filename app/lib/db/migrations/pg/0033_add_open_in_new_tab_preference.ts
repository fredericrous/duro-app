import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

/**
 * Whether links that leave Duro (app tiles, catalog buttons, the portal links
 * in Settings) open in a new tab. NULL means the user never chose, and the
 * default is same-tab so the Back button comes straight back to Duro.
 *
 * Nullable on purpose: it keeps "never asked" distinguishable from an explicit
 * "no" — the only thing that would allow changing the default again later
 * without re-opting everyone in — and avoids rewriting the table.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS open_links_in_new_tab BOOLEAN`
})
