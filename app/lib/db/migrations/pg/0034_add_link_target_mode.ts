import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

/**
 * Three-state link-target preference, replacing the two-state
 * `open_links_in_new_tab` BOOLEAN from 0033:
 *   'same_tab' · 'new_tab' · 'auto'   (NULL = never chose → same_tab)
 *
 * Backfilled from the boolean it replaces so the single release that shipped
 * with 0033 keeps whatever the user picked. NULL there means "never chose", so
 * it stays NULL here rather than being frozen into an explicit 'same_tab'.
 *
 * The old column is deliberately NOT dropped here. The chart runs the
 * Deployment at maxUnavailable:0 / maxSurge:1, so the new pod applies this
 * migration while the OLD pod is still serving writes — dropping now would
 * fail an in-flight save from that pod. The drop is a follow-up release.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS link_target_mode TEXT`
  yield* sql`
    UPDATE user_preferences
       SET link_target_mode = CASE WHEN open_links_in_new_tab THEN 'new_tab' ELSE 'same_tab' END,
           updated_at = NOW()
     WHERE link_target_mode IS NULL
       AND open_links_in_new_tab IS NOT NULL
  `
})
