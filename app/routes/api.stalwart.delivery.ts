import { Effect } from "effect"
import type { Route } from "./+types/api.stalwart.delivery"
import { runEffect } from "~/lib/runtime.server"
import { InviteRepo } from "~/lib/services/InviteRepo.server"
import { parseDeliveryUpdates, verifySignature, type DeliveryUpdate } from "~/lib/stalwart-webhook.server"

/**
 * Stalwart outbound-delivery webhook receiver.
 *
 * Stalwart (the homelab MTA) POSTs delivery/bounce events here over the
 * internal cluster network. Authenticated by an HMAC `X-Signature` over the
 * raw body — no gateway auth, since the call is pod-to-pod and never reaches
 * the Envoy gateway. Correlates each event to an invite (Message-ID first,
 * recipient email as fallback) and records the delivery outcome.
 *
 * Always returns 200 for a validly-signed request so Stalwart doesn't retry a
 * batch forever; a bad signature is 401.
 */
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 })
  }

  const key = process.env.WEBHOOK_SIGNATURE_KEY
  if (!key) {
    console.error("[stalwart-webhook] WEBHOOK_SIGNATURE_KEY not configured")
    return new Response("Webhook not configured", { status: 503 })
  }

  const rawBody = await request.text()
  if (!verifySignature(rawBody, request.headers.get("x-signature"), key)) {
    return new Response("Invalid signature", { status: 401 })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return new Response("Invalid JSON", { status: 400 })
  }

  const updates = parseDeliveryUpdates(parsed)
  if (updates.length === 0) return Response.json({ ok: true, applied: 0 })

  const applied = await runEffect(
    Effect.gen(function* () {
      let count = 0
      for (const u of updates) {
        const ok = yield* applyUpdate(u).pipe(
          Effect.catchAll((e) =>
            Effect.logWarning("[stalwart-webhook] failed to apply update", { error: String(e) }).pipe(Effect.as(false)),
          ),
        )
        if (ok) count++
      }
      return count
    }),
  )

  return Response.json({ ok: true, applied })
}

const applyUpdate = (u: DeliveryUpdate) =>
  Effect.gen(function* () {
    const repo = yield* InviteRepo
    // Correlation cascade: parsed invite id → message id → recipient email.
    let inviteId = u.inviteId
    if (!inviteId && u.messageId) {
      const byMsg = yield* repo.findByMessageId(u.messageId)
      inviteId = byMsg?.id ?? null
    }
    if (!inviteId && u.recipient) {
      const byEmail = yield* repo.findLatestByEmail(u.recipient)
      inviteId = byEmail?.id ?? null
    }

    if (!inviteId) {
      yield* Effect.logWarning("[stalwart-webhook] unmatched delivery event", {
        status: u.status,
        messageId: u.messageId,
        recipient: u.recipient,
      })
      return false
    }

    yield* repo.recordDelivery(inviteId, {
      status: u.status,
      detail: u.detail,
      at: new Date().toISOString(),
    })
    return true
  })
