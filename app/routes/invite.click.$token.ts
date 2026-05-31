import { redirect } from "react-router"
import { Effect } from "effect"
import type { Route } from "./+types/invite.click.$token"
import { runEffect } from "~/lib/runtime.server"
import { InviteRepo } from "~/lib/services/InviteRepo.server"
import { hashToken } from "~/lib/crypto.server"

/**
 * Invite CTA click-tracking redirector.
 *
 * The invite email's "Create Your Account" button points here instead of
 * straight at /invite/:token. We record the click (a human action — a stronger
 * signal than the open pixel, which proxies pre-fetch) and 302 to the real
 * invite page. The raw token is already destined for /invite/:token, so routing
 * through here exposes nothing new; we key the click by its hash.
 *
 * Recording is best-effort: a tracking failure must never block the redirect.
 * The redirect always happens regardless of token validity (an unknown token
 * lands on /invite/:token's "invalid" card) — so this is no enumeration oracle.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const token = params.token
  if (!token) throw redirect("/invite/missing")

  const userAgent = request.headers.get("user-agent")
  await runEffect(
    Effect.gen(function* () {
      const repo = yield* InviteRepo
      yield* repo.recordClick(hashToken(token), userAgent)
    }).pipe(Effect.catchAll((e) => Effect.logWarning("[invite-click] failed to record click", { error: String(e) }))),
  )

  throw redirect(`/invite/${token}`)
}
