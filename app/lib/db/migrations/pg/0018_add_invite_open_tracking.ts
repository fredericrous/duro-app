import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

/**
 * Email open-tracking for invites. A 1x1 pixel embedded in the invite email
 * (served from join.daddyshome.fr, the mTLS-free host) is fetched by the
 * recipient's mail client and records an open here.
 *
 * `open_token` is a dedicated random token used ONLY by the pixel — never the
 * invite token, which grants account creation and must not appear in a URL that
 * mail proxies fetch and log. Existing rows stay NULL (their already-sent emails
 * carry no pixel); new invites get one at create time. The unique index is
 * partial so those NULLs don't collide.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`ALTER TABLE invites ADD COLUMN IF NOT EXISTS open_token TEXT`
  yield* sql`ALTER TABLE invites ADD COLUMN IF NOT EXISTS first_opened_at TIMESTAMPTZ`
  yield* sql`ALTER TABLE invites ADD COLUMN IF NOT EXISTS last_opened_at TIMESTAMPTZ`
  yield* sql`ALTER TABLE invites ADD COLUMN IF NOT EXISTS open_count INTEGER NOT NULL DEFAULT 0`
  yield* sql`ALTER TABLE invites ADD COLUMN IF NOT EXISTS last_open_user_agent TEXT`
  yield* sql`CREATE UNIQUE INDEX IF NOT EXISTS invites_open_token_idx ON invites (open_token) WHERE open_token IS NOT NULL`
})
