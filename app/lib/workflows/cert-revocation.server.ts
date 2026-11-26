import { Data, Effect } from "effect"
import { CertManager, CertManagerError } from "~/lib/services/CertManager.server"
import { CertificateRepo, MAX_REVOKE_ATTEMPTS } from "~/lib/services/CertificateRepo.server"
import { AuditService } from "~/lib/governance/AuditService.server"

/** Which route led to a revocation; recorded in the `cert.revoked` audit metadata. */
export type RevokePath = "admin" | "self" | "recovery" | "reveal" | "user-revoke" | "sweeper"

export interface RevokeSerialOptions {
  /** Owner of the cert, when known; recorded in the audit metadata. */
  readonly auditUsername?: string
  /** Who acted (a username, or a `system` actor); recorded as the audit actor. */
  readonly actorId: string
  readonly path: RevokePath
}

export type RevokeOutcome = Data.TaggedEnum<{
  Revoked: Record<never, never>
  RevokeFailed: { readonly error: string }
}>

const { Revoked, RevokeFailed } = Data.taggedEnum<RevokeOutcome>()

/**
 * Revoke one cert serial in the CA and record the result on its row. Never
 * fails: within a batch a single failure must not abort the rest, so the
 * result is a tagged outcome the caller can count or report. A success marks
 * the row completed and, only when that call is the one that completed it,
 * emits a `cert.revoked` audit event (audit failure is logged, not raised). A
 * failure records the attempt for the sweeper's backoff; a permanent CA
 * refusal sets the attempt count to its cap at once.
 *
 * Called by the admin handlers (`revokeAdminSerial` in admin-users.ts), the
 * revokeInvite and revokeUser workflows (invite.server.ts), recovery approval
 * (recovery.server.ts), `revokeSupersededCert` below, the settings self-revoke
 * and the duro-worker revocation sweep.
 */
export const revokeSerialForUser = (serial: string, opts: RevokeSerialOptions) =>
  Effect.gen(function* () {
    const cert = yield* CertManager
    const certRepo = yield* CertificateRepo
    const audit = yield* AuditService

    const recordFailure = (error: unknown) =>
      Effect.gen(function* () {
        const message = String(error)
        const attempts =
          error instanceof CertManagerError && error.permanent
            ? yield* certRepo.markRevokeAbandoned(serial, message)
            : yield* certRepo.markRevokeFailed(serial, message)
        if (attempts >= MAX_REVOKE_ATTEMPTS) {
          yield* Effect.logError("revocation abandoned", { serial, attempts, error: message })
        }
      }).pipe(
        Effect.catchAll((markError) =>
          Effect.logWarning("cert revocation: marking failed failed", { serial, error: String(markError) }),
        ),
      )

    const emitAudit = audit
      .emit({
        eventType: "cert.revoked",
        actorId: opts.actorId,
        targetType: "user_certificate",
        targetId: serial,
        metadata: { username: opts.auditUsername, path: opts.path },
      })
      .pipe(Effect.catchAll((e) => Effect.logWarning("cert.revoked audit emit failed", { error: String(e) })))

    return yield* cert.revokeCert(serial).pipe(
      Effect.flatMap(() => certRepo.markRevokeCompleted(serial)),
      Effect.flatMap((completedNow) => (completedNow ? emitAudit : Effect.void)),
      Effect.as<RevokeOutcome>(Revoked()),
      Effect.catchAll((e) => recordFailure(e).pipe(Effect.as<RevokeOutcome>(RevokeFailed({ error: String(e) })))),
    )
  })

/**
 * Retire the cert a renewal replaced, once the replacement has actually been
 * revealed to its owner. Best-effort by construction: the user must still get
 * their new certificate even if revoking the old one fails, so every error is
 * swallowed here. A failure leaves revoke_state='failed' on the row: the
 * duro-worker sweeper retries it in the background, and the device list
 * surfaces it with a retry button for an immediate retry.
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
    yield* revokeSerialForUser(serial, { auditUsername: username, actorId: username, path: "reveal" })
  }).pipe(
    Effect.catchAll((e) =>
      Effect.logWarning("[cert-renewal] failed to revoke superseded cert", { serial, error: String(e) }),
    ),
  )
