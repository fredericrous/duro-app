import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

/**
 * Slug fix-up for migration 0015: the S3 garage admin UI is registered with
 * slug `garage-webui`, not `garage`, so 0015's invite-only allowlist missed
 * it. Lock it down here. Idempotent.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    UPDATE applications
    SET access_mode = 'invite_only', updated_at = NOW()
    WHERE slug = 'garage-webui' AND access_mode != 'invite_only'
  `
})
