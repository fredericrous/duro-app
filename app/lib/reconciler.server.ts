import { Effect, Schedule } from "effect"
import { InviteRepo } from "./services/InviteRepo.server"
import { GitHubClient } from "./services/GitHubClient.server"
import { VaultPki } from "./services/VaultPki.server"
import { EmailService } from "./services/EmailService.server"

const STALE_THRESHOLD_MS = 15 * 60 * 1000 // 15 minutes

const reconcileOnce = Effect.gen(function* () {
  const inviteRepo = yield* InviteRepo
  const github = yield* GitHubClient
  const vault = yield* VaultPki
  const emailSvc = yield* EmailService

  const pending = yield* inviteRepo.findAwaitingMerge()

  for (const invite of pending) {
    const ageMs = Date.now() - new Date(invite.createdAt + "Z").getTime()
    if (ageMs > STALE_THRESHOLD_MS) {
      console.error(`[reconciler] invite ${invite.id} (${invite.email}) stale — PR #${invite.prNumber} not merged after 15min, skipping`)
      continue
    }

    let merged = yield* github.checkPRMerged(invite.prNumber!).pipe(
      Effect.catchAll(() => Effect.succeed(false)),
    )

    if (!merged) {
      merged = yield* github.mergePR(invite.prNumber!).pipe(
        Effect.map(() => true),
        Effect.catchAll(() => Effect.succeed(false)),
      )
    }

    if (!merged) continue

    yield* inviteRepo.markPRMerged(invite.id)

    const { p12Buffer } = yield* vault.issueCertAndP12(invite.email, invite.id)
    yield* emailSvc.sendInviteEmail(
      invite.email,
      invite.token,
      invite.invitedBy,
      p12Buffer,
    )
    yield* inviteRepo.markEmailSent(invite.id)

    console.log(`[reconciler] email sent for ${invite.email}`)
  }
}).pipe(
  Effect.catchAll((e) =>
    Effect.sync(() => console.error("[reconciler] error:", e)),
  ),
)

export const reconcileLoop = reconcileOnce.pipe(
  Effect.repeat(Schedule.spaced("2 minutes")),
)
