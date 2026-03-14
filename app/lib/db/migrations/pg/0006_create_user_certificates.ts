import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE IF NOT EXISTS user_certificates (
    id TEXT PRIMARY KEY,
    invite_id TEXT,
    user_id TEXT,
    username TEXT NOT NULL,
    email TEXT NOT NULL,
    serial_number TEXT NOT NULL UNIQUE,
    issued_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    revoke_state TEXT,
    revoke_error TEXT
  )`
  yield* sql`CREATE INDEX IF NOT EXISTS idx_user_certs_user_id ON user_certificates(user_id)`
  yield* sql`CREATE INDEX IF NOT EXISTS idx_user_certs_username ON user_certificates(username)`
  yield* sql`CREATE INDEX IF NOT EXISTS idx_user_certs_valid ON user_certificates(username, revoked_at, expires_at)`
})
