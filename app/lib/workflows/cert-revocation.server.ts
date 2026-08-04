import { Effect } from "effect"
import { CertManager } from "~/lib/services/CertManager.server"
import { CertificateRepo } from "~/lib/services/CertificateRepo.server"
import { AuditService } from "~/lib/governance/AuditService.server"

/**
 * Revoke one cert serial, recording completion or failure. Never fails: within
 * a batch a single failure must NOT abort the rest — revoke as many as possible
 * and record which failed (a security operation should not be blocked by one
 * bad serial; the admin can retry those).
 *
 * When `auditUsername` is provided, a `cert.revoked` audit event is emitted on
 * successful revocation (audit failure swallowed). Shared by the admin batch
 * loops and the revokeInvite/revokeUser workflows.
 */
export const revokeSerialForUser = (serial: string, opts: { auditUsername?: string } = {}) =>
  Effect.gen(function* () {
    const cert = yield* CertManager
    const certRepo = yield* CertificateRepo
    const audit = yield* AuditService
    yield* cert.revokeCert(serial).pipe(
      Effect.tap(() => certRepo.markRevokeCompleted(serial)),
      Effect.tap(() =>
        opts.auditUsername === undefined
          ? Effect.void
          : audit
              .emit({
                eventType: "cert.revoked",
                targetType: "user_certificate",
                targetId: serial,
                metadata: { username: opts.auditUsername },
              })
              .pipe(Effect.catchAll(() => Effect.void)),
      ),
      Effect.catchAll((e) => certRepo.markRevokeFailed(serial, String(e)).pipe(Effect.catchAll(() => Effect.void))),
    )
  })

/**
 * Retire the cert a renewal replaced, once the replacement has actually been
 * revealed to its owner. Best-effort by construction: the user must still get
 * their new certificate even if revoking the old one fails, so every error is
 * swallowed here. A failure leaves revoke_state='failed' on the row, which the
 * device list surfaces with a retry button — the only recovery path, since
 * nothing sweeps stuck revocations in the background.
 *
 * Ownership is re-checked by reading the row rather than trusting an UPDATE's
 * affected-row count, which is driver-dependent here (see setLabel's note).
 */
export const revokeSupersededCert = (serial: string, username: string) =>
  Effect.gen(function* () {
    const certRepo = yield* CertificateRepo
    const existing = yield* certRepo.findBySerial(serial)
    // Already gone, never existed, or not this user's to revoke.
    if (!existing || existing.revokedAt || existing.username !== username) return
    yield* certRepo.markRevokePending(serial, username)
    yield* revokeSerialForUser(serial, { auditUsername: username })
  }).pipe(
    Effect.catchAll((e) =>
      Effect.logWarning("[cert-renewal] failed to revoke superseded cert", { serial, error: String(e) }),
    ),
  )
