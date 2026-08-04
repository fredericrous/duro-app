import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

/**
 * Renewal lineage for device certificates.
 *
 * `user_certificates.renewed_from_serial` points at the cert this one replaces:
 * it drives the device list (the superseded cert shows as a muted sub-row until
 * it is revoked) and the per-cert 24h renewal cooldown (a successor issued less
 * than 24h ago blocks another renewal of the same device).
 *
 * `cert_reveal_tokens.renewed_from_serial` carries the same serial on the reveal
 * link so consuming the reveal can auto-revoke the superseded cert. It is stored
 * here rather than derived from the new cert row on purpose: resendCert treats a
 * failed cert-row insert as non-fatal, so the revocation must not depend on it.
 *
 * No foreign key: serials are unique but rows can be purged, and a dangling
 * pointer has to be inert rather than an insert failure.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE user_certificates ADD COLUMN IF NOT EXISTS renewed_from_serial TEXT`
  yield* sql`CREATE INDEX IF NOT EXISTS idx_user_certs_renewed_from ON user_certificates(renewed_from_serial)`
  yield* sql`ALTER TABLE cert_reveal_tokens ADD COLUMN IF NOT EXISTS renewed_from_serial TEXT`
})
