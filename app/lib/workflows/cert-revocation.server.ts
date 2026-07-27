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
