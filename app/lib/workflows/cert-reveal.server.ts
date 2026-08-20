import { Effect } from "effect"
import { CertRevealRepo } from "~/lib/services/CertRevealRepo.server"
import { CertManager } from "~/lib/services/CertManager.server"
import { CertificateRepo } from "~/lib/services/CertificateRepo.server"
import { PreferencesRepo } from "~/lib/services/PreferencesRepo.server"
import { hashToken } from "~/lib/crypto.server"
import { revokeSupersededCert } from "~/lib/workflows/cert-revocation.server"
import { defaultDeviceName } from "~/lib/device-name"

/**
 * Persist what KIND of device is claiming the cert, derived from the claim
 * request's User-Agent — the browser opening this page IS the new device, so
 * the server-observed header is more trustworthy than any client-sent field.
 * Stored in its own column, separate from the user-editable label: renaming
 * "iPhone" to "perso" must not erase the fact that it is an iPhone.
 * Best-effort and set-if-null; older reveal rows without a serial are skipped.
 */
const recordClaimedPlatform = (row: { serialNumber: string | null }, userAgent: string | null | undefined) =>
  Effect.gen(function* () {
    if (!row.serialNumber || !userAgent) return
    const platform = defaultDeviceName(userAgent)
    if (!platform) return
    const certRepo = yield* CertificateRepo
    yield* certRepo.setClaimedPlatform(row.serialNumber, platform)
  })

/**
 * Resolve the reveal token to its current state. Shared by the loader, action
 * and download route. The loader/download only READ; the password is burned
 * (one-time) only on the explicit reveal POST, so a link-scanner's prefetch GET
 * cannot consume it. The cert (.p12) stays downloadable for the token's 24h
 * lifetime — it's the password that is single-use.
 */
export const resolveReveal = (revealToken: string) =>
  Effect.gen(function* () {
    const revealRepo = yield* CertRevealRepo
    const cert = yield* CertManager
    const row = yield* revealRepo.findByTokenHash(hashToken(revealToken))
    if (!row) return { state: "invalid" as const }
    if (new Date(row.expiresAt) < new Date()) return { state: "expired" as const, row }
    const password = yield* cert.getP12Password(row.renewalId)
    const p12 = yield* cert.getP12(row.renewalId)
    if (!password && !p12) return { state: "consumed" as const, row }
    // Password already burned but the cert is still downloadable.
    if (!password) return { state: "revealed" as const, row }
    return { state: "ok" as const, row, password }
  })

/**
 * Burn the one-time password and, for a renewal, retire the cert it replaces.
 *
 * Revoke-on-reveal is the moment the new certificate demonstrably reached its
 * owner, which is the earliest point the old one can go without risking an
 * mTLS lockout. It is deliberately the last step and cannot fail the reveal:
 * losing a revocation is recoverable, losing the password is not (it exists
 * nowhere else once consumed).
 *
 * Returns the password itself when (and only when) this call burned it: the
 * explicit reveal POST is the single request that ever carries the secret.
 * The loader never does — a GET (prefetchable, cacheable, SSR-serialized)
 * must stay secret-free, so disclosure and burn are one atomic transaction.
 */
export const consumeReveal = (revealToken: string, userAgent?: string | null) =>
  Effect.gen(function* () {
    const revealRepo = yield* CertRevealRepo
    const cert = yield* CertManager
    const result = yield* resolveReveal(revealToken)
    if (result.state !== "ok") return { consumed: false as const, password: null }
    yield* revealRepo.markRevealed(result.row.id)
    yield* cert.consumeP12Password(result.row.renewalId)
    yield* recordClaimedPlatform(result.row, userAgent)
    if (result.row.renewedFromSerial) {
      yield* revokeSupersededCert(result.row.renewedFromSerial, result.row.username)
    }
    return { consumed: true as const, password: result.password }
  })

/**
 * Claim-time device naming: the QR/email link is minted NAME-LESS, and the
 * device names itself on the claim page. Allowed while the token is alive
 * (ok) and after the password was revealed (revealed) — the person holding
 * the link IS the device owner mid-setup; naming after the scratch is the
 * natural order. Never allowed on invalid/expired tokens, and only for
 * reveal rows that carry a serial (older rows predate the column).
 *
 * The label passes the same trim/cap rules as the /devices rename.
 */
export const nameDeviceFromReveal = (revealToken: string, rawLabel: string, userAgent?: string | null) =>
  Effect.gen(function* () {
    const certRepo = yield* CertificateRepo
    const result = yield* resolveReveal(revealToken)
    if (result.state !== "ok" && result.state !== "revealed") {
      return { named: false as const, reason: result.state }
    }
    if (!result.row.serialNumber) {
      return { named: false as const, reason: "unnameable" as const }
    }
    const label = rawLabel.trim().slice(0, 64)
    if (label === "") return { named: false as const, reason: "empty" as const }
    const affected = yield* certRepo.setLabel(result.row.serialNumber, result.row.username, label)
    if (affected === 0) return { named: false as const, reason: "missing" as const }
    yield* recordClaimedPlatform(result.row, userAgent)
    return { named: true as const, label }
  })

/**
 * Has the certificate this reveal delivers already been revoked? Revoking the
 * device you were in the middle of setting up (the refund path below) leaves
 * its reveal row alive; without this check the page would keep offering a
 * link that downloads a dead certificate. A missing cert row is NOT proof of
 * revocation — storing it is best-effort — so that case stays resumable.
 */
const isRevoked = (serialNumber: string | null) =>
  Effect.gen(function* () {
    if (!serialNumber) return false
    const certRepo = yield* CertificateRepo
    const cert = yield* certRepo.findBySerial(serialNumber)
    return cert !== null && cert.revokedAt !== null
  })

/**
 * A device setup left mid-flight: the newest unexpired reveal whose one-time
 * password is still unburned. That is exactly the state worth resuming — the
 * link is fully actionable. Once the password has been scratched the cert is
 * only recoverable by revoking it and starting over, so this deliberately
 * reports nothing rather than offering a link that cannot finish the job.
 *
 * Returns metadata only. The raw token is NOT recoverable (the table stores
 * its hash) and must never ride a loader anyway.
 */
export const findPendingClaim = (username: string) =>
  Effect.gen(function* () {
    const revealRepo = yield* CertRevealRepo
    const cert = yield* CertManager
    const row = yield* revealRepo.findLatestLive(username)
    if (!row) return null
    if (yield* isRevoked(row.serialNumber)) return null
    const password = yield* cert.getP12Password(row.renewalId)
    if (!password) return null
    // Normalised: the pg driver hands back a Date for timestamptz even though
    // the row type says string, and this value crosses into loader data.
    return { expiresAt: new Date(row.expiresAt).toISOString() }
  })

/**
 * Hand the waiting setup back to the user as a fresh link. Mints a NEW reveal
 * token against the SAME renewal: no certificate is issued and the daily
 * budget is untouched, because nothing new was created — this is the same
 * credential, addressed again.
 *
 * The new token inherits the original expiry rather than restarting the 24h
 * clock: re-showing a link must not extend the window the credential was
 * granted for.
 */
export const reissueClaimLink = (username: string) =>
  Effect.gen(function* () {
    const revealRepo = yield* CertRevealRepo
    const cert = yield* CertManager
    const row = yield* revealRepo.findLatestLive(username)
    if (!row) return null
    if (yield* isRevoked(row.serialNumber)) return null
    const password = yield* cert.getP12Password(row.renewalId)
    if (!password) return null
    const { token } = yield* revealRepo.create({
      renewalId: row.renewalId,
      email: row.email,
      username: row.username,
      expiresAt: new Date(row.expiresAt),
      renewedFromSerial: row.renewedFromSerial,
      serialNumber: row.serialNumber,
    })
    return { token, expiresAt: new Date(row.expiresAt).toISOString() }
  })

/**
 * Give the daily new-device budget back when the certificate that SPENT it is
 * revoked — an undo of today's issuance, not a general revoke-one-get-one.
 *
 * The distinction is the whole security argument: refunding any revocation
 * would let anyone holding a session trade a pile of stale devices for a pile
 * of fresh 90-day credentials. Scoped this way the user can churn (issue,
 * revoke, issue) but never accumulate, because each new certificate costs
 * them the previous one.
 *
 * Callers MUST only reach here once the revocation actually completed:
 * refunding a FAILED revocation would hand back the budget while the
 * certificate still works.
 */
export const refundBudgetIfSpentOn = (serialNumber: string, username: string) =>
  Effect.gen(function* () {
    const revealRepo = yield* CertRevealRepo
    const prefs = yield* PreferencesRepo
    const { renewalId } = yield* prefs.getLastCertRenewal(username)
    if (!renewalId) return false
    const row = yield* revealRepo.findBySerial(serialNumber)
    // No reveal row (certs predating the serial column) or a different
    // renewal → this is not the cert that spent the budget. Leave it spent.
    if (!row || row.username !== username || row.renewalId !== renewalId) return false
    yield* prefs.clearCertRenewal(username)
    return true
  })
