import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

/**
 * Retry bookkeeping for the duro-worker revocation sweeper.
 *
 * `revoke_attempts` counts failures; `revoke_next_at` is when the sweeper may
 * try the row again (NULL reads as "due now"). Rows already stuck in
 * `pending`/`failed` (recovery with revokeOthers never called Vault) are
 * backfilled as due now so the first sweep completes them.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE user_certificates ADD COLUMN IF NOT EXISTS revoke_attempts INTEGER NOT NULL DEFAULT 0`
  yield* sql`ALTER TABLE user_certificates ADD COLUMN IF NOT EXISTS revoke_next_at TIMESTAMPTZ`
  yield* sql`UPDATE user_certificates SET revoke_next_at = NOW()
             WHERE revoke_state IN ('pending', 'failed') AND revoked_at IS NULL`
})
