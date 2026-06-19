import type { Route } from "./+types/cert.$revealToken.download"
import { runEffect } from "~/lib/runtime.server"
import { CertRevealRepo } from "~/lib/services/CertRevealRepo.server"
import { CertManager } from "~/lib/services/CertManager.server"
import { hashToken } from "~/lib/crypto.server"
import { Effect } from "effect"

/**
 * Streams the P12 bundle for a valid, unexpired reveal token. Resource route
 * (no component) — `Content-Disposition: attachment` makes the browser save it.
 * Reads only; the cert stays downloadable for the token's 24h lifetime (it's
 * the password that is single-use, burned on the reveal POST).
 */
export async function loader({ params }: Route.LoaderArgs) {
  const revealToken = params.revealToken
  if (!revealToken) throw new Response("Not found", { status: 404 })

  const p12 = await runEffect(
    Effect.gen(function* () {
      const revealRepo = yield* CertRevealRepo
      const cert = yield* CertManager
      const row = yield* revealRepo.findByTokenHash(hashToken(revealToken))
      if (!row || new Date(row.expiresAt) < new Date()) return null
      return yield* cert.getP12(row.renewalId)
    }),
  ).catch((e) => {
    console.error("[cert-reveal/download] error:", e)
    return null
  })

  if (!p12) throw new Response("Certificate not available or link expired", { status: 404 })

  return new Response(new Uint8Array(p12), {
    headers: {
      "Content-Type": "application/x-pkcs12",
      "Content-Disposition": 'attachment; filename="certificate.p12"',
      "Content-Length": String(p12.length),
      "Cache-Control": "no-store",
    },
  })
}
