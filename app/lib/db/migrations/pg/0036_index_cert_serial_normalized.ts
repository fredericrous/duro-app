import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

/**
 * Functional index for looking a certificate up by the *canonical* form of its
 * serial number.
 *
 * A serial arriving from a presented client certificate (parsed out of the
 * Envoy XFCC header) and the serial Vault PKI stored at issue time are the same
 * integer but not the same string: Vault writes lowercase colon-separated hex
 * (`3a:1f:…`) while an X.509 parser yields bare hex, and ASN.1 positive-integer
 * padding means one side may carry a leading zero the other drops. The setup
 * flow compares them as canonical integers — lowercase, no separators, leading
 * zeros stripped — via `ltrim(lower(replace(serial_number, ':', '')), '0')`.
 *
 * The lookup lives on the login-adjacent path, so it gets its own index rather
 * than a scan. NOT unique: the existing UNIQUE(serial_number) already guarantees
 * uniqueness, and a UNIQUE functional index would only risk failing this
 * migration on some legacy row for no gain. The expression here must stay
 * byte-for-byte identical to the one CertificateRepo.findBySerialCanonical uses,
 * or Postgres will silently ignore the index.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE INDEX IF NOT EXISTS idx_user_certs_serial_norm
             ON user_certificates (ltrim(lower(replace(serial_number, ':', '')), '0'))`
})
