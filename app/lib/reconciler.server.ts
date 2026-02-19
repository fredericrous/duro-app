import { Effect, Schedule } from "effect"
import { InviteRepo, type Invite } from "./services/InviteRepo.server"
import { GitHubClient } from "./services/GitHubClient.server"
import { VaultPki } from "./services/VaultPki.server"
import { EmailService } from "./services/EmailService.server"

const MAX_RECONCILE_ATTEMPTS = 5

const processInvite = (invite: Invite) =>
  Effect.gen(function* () {
    const inviteRepo = yield* InviteRepo
    const github = yield* GitHubClient
    const vault = yield* VaultPki
    const emailSvc = yield* EmailService

    // Check/attempt merge
    let merged = yield* github.checkPRMerged(invite.prNumber!).pipe(
      Effect.tapError((e) =>
        Effect.logDebug("Failed to check PR merged status", { prNumber: invite.prNumber, error: String(e) }),
      ),
      Effect.catchAll(() => Effect.succeed(false)),
    )

    if (!merged) {
      merged = yield* github.mergePR(invite.prNumber!).pipe(
        Effect.map(() => true),
        Effect.tapError((e) => Effect.logDebug("Failed to merge PR", { prNumber: invite.prNumber, error: String(e) })),
        Effect.catchAll(() => Effect.succeed(false)),
      )
    }

    if (!merged) return

    yield* inviteRepo.markPRMerged(invite.id)

    // Issue cert and P12
    const { p12Buffer } = yield* vault.issueCertAndP12(invite.email, invite.id)

    // Send email
    yield* emailSvc.sendInviteEmail(invite.email, invite.token, invite.invitedBy, p12Buffer)
    yield* inviteRepo.markEmailSent(invite.id)
    yield* inviteRepo.clearReconcileError(invite.id)

    yield* Effect.log(`email sent for ${invite.email}`)
  })

const verifyCerts = Effect.gen(function* () {
  const inviteRepo = yield* InviteRepo
  const vault = yield* VaultPki

  const pending = yield* inviteRepo.findAwaitingCertVerification()

  for (const invite of pending) {
    if (!invite.certUsername) continue

    const processed = yield* vault.checkCertProcessed(invite.certUsername)
    if (processed) {
      yield* inviteRepo.markCertVerified(invite.id)
      yield* Effect.log(`cert verified for ${invite.email} (${invite.certUsername})`)
    }
  }
}).pipe(Effect.catchAll((e) => Effect.logError("cert verify error").pipe(Effect.annotateLogs("error", String(e)))))

const processRevertInvite = (invite: Invite) =>
  Effect.gen(function* () {
    const inviteRepo = yield* InviteRepo
    const github = yield* GitHubClient

    // Check/attempt merge of revert PR
    let merged = yield* github.checkPRMerged(invite.revertPrNumber!).pipe(
      Effect.tapError((e) =>
        Effect.logDebug("Failed to check revert PR merged status", {
          prNumber: invite.revertPrNumber,
          error: String(e),
        }),
      ),
      Effect.catchAll(() => Effect.succeed(false)),
    )

    if (!merged) {
      merged = yield* github.mergePR(invite.revertPrNumber!).pipe(
        Effect.map(() => true),
        Effect.tapError((e) =>
          Effect.logDebug("Failed to merge revert PR", { prNumber: invite.revertPrNumber, error: String(e) }),
        ),
        Effect.catchAll(() => Effect.succeed(false)),
      )
    }

    if (!merged) return

    yield* inviteRepo.markRevertPRMerged(invite.id)
    yield* inviteRepo.clearReconcileError(invite.id)
    yield* Effect.log(`revert PR merged for ${invite.email}, revocation complete`)
  })

const reconcileOnce = Effect.gen(function* () {
  const inviteRepo = yield* InviteRepo

  const pending = yield* inviteRepo.findAwaitingMerge()

  for (const invite of pending) {
    // Backoff: skip if too soon since last attempt
    if (invite.reconcileAttempts > 0 && invite.lastReconcileAt) {
      const backoffMs = Math.min(Math.pow(2, invite.reconcileAttempts) * 30_000, 600_000)
      const elapsed = Date.now() - new Date(invite.lastReconcileAt).getTime()
      if (elapsed < backoffMs) continue
    }

    yield* processInvite(invite).pipe(
      Effect.catchAll((e) =>
        Effect.gen(function* () {
          const msg = e instanceof Error ? e.message : String(e)
          if (invite.reconcileAttempts + 1 >= MAX_RECONCILE_ATTEMPTS) {
            yield* inviteRepo.markFailed(invite.id, msg)
            yield* Effect.logError(
              `invite ${invite.id} (${invite.email}) permanently failed after ${MAX_RECONCILE_ATTEMPTS} attempts: ${msg}`,
            )
          } else {
            yield* inviteRepo.recordReconcileError(invite.id, msg)
            yield* Effect.logWarning(
              `invite ${invite.id} (${invite.email}) attempt ${invite.reconcileAttempts + 1} failed: ${msg}`,
            )
          }
        }),
      ),
    )
  }

  yield* verifyCerts

  // Reconcile pending revert PRs (revoking invites)
  const revoking = yield* inviteRepo.findAwaitingRevertMerge()
  for (const invite of revoking) {
    if (invite.reconcileAttempts > 0 && invite.lastReconcileAt) {
      const backoffMs = Math.min(Math.pow(2, invite.reconcileAttempts) * 30_000, 600_000)
      const elapsed = Date.now() - new Date(invite.lastReconcileAt).getTime()
      if (elapsed < backoffMs) continue
    }

    yield* processRevertInvite(invite).pipe(
      Effect.catchAll((e) =>
        Effect.gen(function* () {
          const msg = e instanceof Error ? e.message : String(e)
          if (invite.reconcileAttempts + 1 >= MAX_RECONCILE_ATTEMPTS) {
            yield* inviteRepo.markFailed(invite.id, msg)
            yield* Effect.logError(
              `revert for ${invite.id} (${invite.email}) permanently failed after ${MAX_RECONCILE_ATTEMPTS} attempts: ${msg}`,
            )
          } else {
            yield* inviteRepo.recordReconcileError(invite.id, msg)
            yield* Effect.logWarning(
              `revert for ${invite.id} (${invite.email}) attempt ${invite.reconcileAttempts + 1} failed: ${msg}`,
            )
          }
        }),
      ),
    )
  }
}).pipe(Effect.catchAll((e) => Effect.logError("reconciler error").pipe(Effect.annotateLogs("error", String(e)))))

export const reconcileLoop = reconcileOnce.pipe(Effect.repeat(Schedule.spaced("2 minutes")))
