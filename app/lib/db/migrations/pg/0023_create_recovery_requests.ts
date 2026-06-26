import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

/**
 * Admin-approval device recovery requests.
 *
 * A user who lost all their devices (so has no working mTLS cert) submits an
 * email at the public /recover page; this records a PENDING request that an
 * admin reviews and approves (→ resendCert) or denies. Deliberately carries no
 * secret and no password — the admin is the verification gate.
 *
 * `recovery_requests_one_pending` enforces at most one open request per email
 * (dedup / anti-spam); the status index drives the admin list.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`CREATE TABLE IF NOT EXISTS recovery_requests (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    username TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    request_ip TEXT,
    renewal_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by TEXT
  )`

  yield* sql`CREATE UNIQUE INDEX IF NOT EXISTS recovery_requests_one_pending
             ON recovery_requests (email) WHERE status = 'pending'`

  yield* sql`CREATE INDEX IF NOT EXISTS recovery_requests_status_idx
             ON recovery_requests (status, created_at)`
})
