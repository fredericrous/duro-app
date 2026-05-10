import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  // Prevent two pending requests for the same target. role_id and entitlement_id
  // are nullable but the table CHECK guarantees exactly one is non-null, so
  // COALESCE-to-sentinel collapses the two columns into a single deduping key.
  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_access_requests_pending_uniq
      ON access_requests (
        requester_id,
        application_id,
        COALESCE(role_id, '__none__'),
        COALESCE(entitlement_id, '__none__')
      )
      WHERE status = 'pending'
  `
})
