import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

/**
 * SMTP delivery tracking for invites, fed by a Stalwart webhook.
 *
 * "Sent" (email_sent) only means duro handed the message to Stalwart. These
 * columns record what Stalwart's outbound queue actually did: delivered to the
 * recipient MX, deferred (transient, retrying), or bounced (permanent failure).
 * Correlation back to an invite is primarily by message_id (the deterministic
 * RFC Message-ID we set at send), with recipient email as a fallback — hence
 * the index. Existing rows stay NULL; their already-sent mail carries no hook.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`ALTER TABLE invites ADD COLUMN IF NOT EXISTS message_id TEXT`
  yield* sql`ALTER TABLE invites ADD COLUMN IF NOT EXISTS delivery_status TEXT`
  yield* sql`ALTER TABLE invites ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ`
  yield* sql`ALTER TABLE invites ADD COLUMN IF NOT EXISTS bounced_at TIMESTAMPTZ`
  yield* sql`ALTER TABLE invites ADD COLUMN IF NOT EXISTS last_delivery_event_at TIMESTAMPTZ`
  yield* sql`ALTER TABLE invites ADD COLUMN IF NOT EXISTS delivery_detail TEXT`
  yield* sql`CREATE INDEX IF NOT EXISTS invites_message_id_idx ON invites (message_id) WHERE message_id IS NOT NULL`
})
