import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

/**
 * Contract half of the expand/contract begun in 0034: drop the two-state
 * `open_links_in_new_tab` BOOLEAN now that `link_target_mode` has replaced it.
 *
 * Deliberately a SEPARATE release from 0034. The chart runs the Deployment at
 * maxUnavailable:0 / maxSurge:1, so a migration lands while the PREVIOUS pod is
 * still serving writes — dropping in 0034 could have failed an in-flight save
 * from a pod that still wrote this column. By now the running release (1.57.0)
 * has no reference to it outside migrations, so no live code can touch it.
 *
 * 0034's backfill still reads this column, which is why the drop lives here and
 * not there: on a fresh database the sequence is add (0033) → backfill (0034) →
 * drop (0035), and each step sees the schema it expects.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE user_preferences DROP COLUMN IF EXISTS open_links_in_new_tab`
})
