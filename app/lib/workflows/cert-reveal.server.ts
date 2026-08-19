import { Effect } from "effect"
import { CertRevealRepo } from "~/lib/services/CertRevealRepo.server"
import { CertManager } from "~/lib/services/CertManager.server"
import { CertificateRepo } from "~/lib/services/CertificateRepo.server"
import { hashToken } from "~/lib/crypto.server"
import { revokeSupersededCert } from "~/lib/workflows/cert-revocation.server"

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
 * Returns whether the password was handed out.
 */
export const consumeReveal = (revealToken: string) =>
  Effect.gen(function* () {
    const revealRepo = yield* CertRevealRepo
    const cert = yield* CertManager
    const result = yield* resolveReveal(revealToken)
    if (result.state !== "ok") return false
    yield* revealRepo.markRevealed(result.row.id)
    yield* cert.consumeP12Password(result.row.renewalId)
    if (result.row.renewedFromSerial) {
      yield* revokeSupersededCert(result.row.renewedFromSerial, result.row.username)
    }
    return true
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
export const nameDeviceFromReveal = (revealToken: string, rawLabel: string) =>
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
    return { named: true as const, label }
  })
