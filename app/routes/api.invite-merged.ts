import type { Route } from "./+types/api.invite-merged"
import { Effect } from "effect"
import { runEffect } from "~/lib/runtime.server"
import { InviteRepo } from "~/lib/services/InviteRepo.server"
import { VaultPki } from "~/lib/services/VaultPki.server"
import { EmailService } from "~/lib/services/EmailService.server"

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 })
  }

  const webhookSecret = process.env.WEBHOOK_SECRET
  if (!webhookSecret) {
    return Response.json({ error: "Webhook not configured" }, { status: 503 })
  }

  const authHeader = request.headers.get("Authorization")
  if (authHeader !== `Bearer ${webhookSecret}`) {
    return new Response("Unauthorized", { status: 401 })
  }

  let body: { inviteId?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { inviteId } = body
  if (!inviteId || typeof inviteId !== "string") {
    return Response.json({ error: "Missing inviteId" }, { status: 400 })
  }

  try {
    await runEffect(
      Effect.gen(function* () {
        const inviteRepo = yield* InviteRepo
        const vault = yield* VaultPki
        const emailSvc = yield* EmailService

        const invite = yield* inviteRepo.findById(inviteId)
        if (!invite) return // Idempotent: not found is OK
        if (invite.emailSent) return // Already processed

        yield* inviteRepo.markPRMerged(invite.id)

        const { p12Buffer } = yield* vault.issueCertAndP12(invite.email, invite.id)
        yield* emailSvc.sendInviteEmail(invite.email, invite.token, invite.invitedBy, p12Buffer)
        yield* inviteRepo.markEmailSent(invite.id)
        yield* inviteRepo.clearReconcileError(invite.id)

        console.log(`[webhook] email sent for ${invite.email}`)
      }),
    )

    return Response.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[webhook] error processing invite ${inviteId}:`, msg)

    // Record the error for visibility
    try {
      await runEffect(
        Effect.gen(function* () {
          const inviteRepo = yield* InviteRepo
          yield* inviteRepo.recordReconcileError(inviteId, `webhook: ${msg}`)
        }),
      )
    } catch {
      /* best-effort */
    }

    return Response.json({ error: msg }, { status: 500 })
  }
}
