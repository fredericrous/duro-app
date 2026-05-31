import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

/**
 * Click-tracking for the invite email's call-to-action.
 *
 * A click is a human action, so it's a stronger engagement signal than the
 * open pixel (which mail proxies pre-fetch on delivery). The CTA routes through
 * /c/:token, which records the click and redirects to /invite/:token. We key
 * clicks by the existing token_hash — the raw token already lives in the CTA
 * URL by design (it's where the recipient is headed), so no new token column is
 * needed. Some link scanners (Outlook SafeLinks, Proofpoint) auto-visit links,
 * so last_click_user_agent lets the UI flag likely-scanner clicks.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`ALTER TABLE invites ADD COLUMN IF NOT EXISTS first_clicked_at TIMESTAMPTZ`
  yield* sql`ALTER TABLE invites ADD COLUMN IF NOT EXISTS last_clicked_at TIMESTAMPTZ`
  yield* sql`ALTER TABLE invites ADD COLUMN IF NOT EXISTS click_count INTEGER NOT NULL DEFAULT 0`
  yield* sql`ALTER TABLE invites ADD COLUMN IF NOT EXISTS last_click_user_agent TEXT`
})
