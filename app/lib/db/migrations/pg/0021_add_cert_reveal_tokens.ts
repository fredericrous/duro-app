import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

/**
 * Tokenised reveal links for certificate re-sends.
 *
 * Unlike onboarding (where the P12 password is revealed on the /invite/:token
 * page the recipient is already headed to), a re-sent cert for an EXISTING
 * user has no such page. So the cert-renewal email carries a dedicated
 * single-purpose reveal link (/cert/:token) backed by a row here.
 *
 * We store only the SHA-256 hash of the token — the raw token lives solely in
 * the emailed URL. The link is short-lived (expires_at) and single-use
 * (revealed_at is stamped, and the underlying Vault P12 password secret is
 * consumed, on first scratch). renewal_id is the same id the P12 password is
 * keyed under in Vault (see CertManager.issueCertAndP12).
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`CREATE TABLE IF NOT EXISTS cert_reveal_tokens (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    renewal_id TEXT NOT NULL,
    email TEXT NOT NULL,
    username TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revealed_at TIMESTAMPTZ
  )`
  yield* sql`CREATE INDEX IF NOT EXISTS idx_cert_reveal_renewal_id ON cert_reveal_tokens(renewal_id)`
})
