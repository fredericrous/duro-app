import type { Route } from "./+types/invite.$token.download"
import { runEffect } from "~/lib/runtime.server"
import { InviteRepo } from "~/lib/services/InviteRepo.server"
import { CertManager } from "~/lib/services/CertManager.server"
import { hashToken } from "~/lib/crypto.server"
import { Effect } from "effect"

/**
 * Streams the P12 bundle for a valid, unconsumed invite token. Resource route
 * (no component) — `Content-Disposition: attachment` makes the browser save it.
 *
 * Why this exists: the invite email used to carry the .p12 as an attachment,
 * which trips Gmail's phishing heuristics (and the SES relay inherits the spam
 * signal). Instead the file is downloaded from the /invite page, behind the
 * same token that already reveals the password — the same split the renewal
 * email uses (/cert/:revealToken/download). The cert stays downloadable until
 * the invite is accepted (which deletes the P12) or expires.
 */
export async function loader({ params }: Route.LoaderArgs) {
  const token = params.token
  if (!token) throw new Response("Not found", { status: 404 })

  const p12 = await runEffect(
    Effect.gen(function* () {
      const repo = yield* InviteRepo
      const cert = yield* CertManager
      const invite = yield* repo.findByTokenHash(hashToken(token))
      if (!invite || invite.usedAt || new Date(invite.expiresAt) < new Date()) return null
      return yield* cert.getP12(invite.id)
    }),
  ).catch((e) => {
    console.error("[invite/download] error:", e)
    return null
  })

  if (!p12) throw new Response("Certificate not available or invite expired", { status: 404 })

  return new Response(new Uint8Array(p12), {
    headers: {
      "Content-Type": "application/x-pkcs12",
      "Content-Disposition": 'attachment; filename="certificate.p12"',
      "Content-Length": String(p12.length),
      "Cache-Control": "no-store",
    },
  })
}
