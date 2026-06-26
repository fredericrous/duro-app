import { Data, Effect } from "effect"
import { UserManager } from "~/lib/services/UserManager.server"
import { RecoveryRepo } from "~/lib/services/RecoveryRepo.server"
import { EmailService } from "~/lib/services/EmailService.server"
import { AuditService } from "~/lib/governance/AuditService.server"
import { resendCert } from "~/lib/workflows/invite.server"
import { config } from "~/lib/config.server"

// ---------------------------------------------------------------------------
// Admin-approval device recovery.
//
// A user who lost all their devices has no working mTLS cert, so /settings is
// unreachable. They submit their email at the public /recover page; an admin
// reviews and approves (→ resendCert, which emails the reveal link to the
// account's own inbox) or denies. No password is verified and no secret is
// shown on the public path — the admin (a human who knows the user) is the
// verification gate, and the cert is delivered only to the account email.
// ---------------------------------------------------------------------------

const HOUR_MS = 60 * 60 * 1000
const MAX_PER_EMAIL_PER_HOUR = 3
const MAX_PER_IP_PER_HOUR = 10
const MAX_NOTE = 280

export class RecoveryError extends Data.TaggedError("RecoveryError")<{
  readonly code: "not_found" | "issue_failed" | "db"
  readonly message?: string
}> {}

export interface RecoveryRequestInput {
  email: string
  note?: string | null
  requestIp?: string | null
}

/**
 * Record a pending recovery request. Anti-enumeration: succeeds silently on
 * EVERY branch (invalid email, rate-limited, unknown account, duplicate, DB
 * race) so the caller can always show one identical message. Only a real,
 * first, in-budget request for a known account creates a row + notifies admins.
 */
export const requestRecovery = (input: RecoveryRequestInput) =>
  Effect.gen(function* () {
    const email = input.email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return
    const note = input.note ? input.note.trim().slice(0, MAX_NOTE) || null : null
    const ip = input.requestIp ?? null

    const repo = yield* RecoveryRepo

    // Rate-limit per email + per IP. Over budget → silent no-op.
    const since = new Date(Date.now() - HOUR_MS).toISOString()
    if ((yield* repo.countRecentByEmail(email, since)) >= MAX_PER_EMAIL_PER_HOUR) return
    if (ip && (yield* repo.countRecentByIp(ip, since)) >= MAX_PER_IP_PER_HOUR) return

    // Resolve to a real account; unknown email → silent no-op (anti-enumeration).
    const users = yield* UserManager
    const all = yield* users.getUsers.pipe(Effect.orElseSucceed(() => []))
    const user = all.find((u) => u.email.toLowerCase() === email)
    if (!user) return

    // Dedup — at most one open request per email (the unique index is the
    // race-safe backstop; a losing race surfaces as a create error → no-op).
    if (yield* repo.findPendingByEmail(email)) return
    const created = yield* repo.create({ email, username: user.id, note, requestIp: ip }).pipe(Effect.either)
    if (created._tag === "Left") return

    const audit = yield* AuditService
    yield* audit
      .emit({
        eventType: "recovery.requested",
        targetType: "user",
        targetId: user.id,
        metadata: { email, requestId: created.right.id, note },
        ipAddress: ip ?? undefined,
      })
      .pipe(Effect.catchAll(() => Effect.void))

    // Best-effort admin notification; the admin panel is the authoritative list.
    if (config.adminEmail) {
      const emailSvc = yield* EmailService
      yield* emailSvc
        .sendRecoveryNotificationEmail(config.adminEmail, email, note)
        .pipe(Effect.catchAll((e) => Effect.logWarning("recovery: admin notification failed", { error: String(e) })))
    }
  }).pipe(Effect.withSpan("requestRecovery"))

/** Approve a pending request: issue a fresh cert (emailed reveal link) + audit. */
export const approveRecovery = (requestId: string, adminUser: string) =>
  Effect.gen(function* () {
    const repo = yield* RecoveryRepo
    const req = yield* repo.findById(requestId).pipe(Effect.mapError(() => new RecoveryError({ code: "db" })))
    if (!req || req.status !== "pending") return yield* new RecoveryError({ code: "not_found" })

    const result = yield* resendCert(req.email, req.username).pipe(
      Effect.mapError(
        (e) =>
          new RecoveryError({ code: "issue_failed", message: e instanceof Error ? e.message : "resendCert failed" }),
      ),
    )

    yield* repo
      .markReviewed(requestId, "approved", adminUser, result.renewalId)
      .pipe(Effect.mapError(() => new RecoveryError({ code: "db" })))

    const audit = yield* AuditService
    yield* audit
      .emit({
        eventType: "recovery.approved",
        actorId: adminUser,
        targetType: "user",
        targetId: req.username,
        metadata: { email: req.email, requestId },
      })
      .pipe(Effect.catchAll(() => Effect.void))

    return { email: req.email }
  }).pipe(Effect.withSpan("approveRecovery", { attributes: { requestId } }))

/** Deny a pending request + audit. */
export const denyRecovery = (requestId: string, adminUser: string) =>
  Effect.gen(function* () {
    const repo = yield* RecoveryRepo
    const affected = yield* repo
      .markReviewed(requestId, "denied", adminUser)
      .pipe(Effect.mapError(() => new RecoveryError({ code: "db" })))
    if (affected === 0) return yield* new RecoveryError({ code: "not_found" })

    const audit = yield* AuditService
    yield* audit
      .emit({ eventType: "recovery.denied", actorId: adminUser, targetType: "recovery_request", targetId: requestId })
      .pipe(Effect.catchAll(() => Effect.void))
  }).pipe(Effect.withSpan("denyRecovery", { attributes: { requestId } }))
