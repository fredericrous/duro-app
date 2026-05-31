import { Effect } from "effect"
import type { Route } from "./+types/invite.open.$openToken"
import { runEffect } from "~/lib/runtime.server"
import { InviteRepo } from "~/lib/services/InviteRepo.server"

// Smallest possible transparent GIF (1x1, GIF89a). Returned for EVERY request —
// valid or unknown token alike — so the endpoint never reveals invite validity.
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64")

const pixelResponse = () =>
  new Response(PIXEL, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.byteLength),
      // Defeat proxy/client caching so re-opens re-hit us.
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
    },
  })

/**
 * Invite email open-tracking pixel.
 *
 * Served from join.daddyshome.fr (the mTLS-free host) so recipients' mail
 * clients can fetch it. Records the open against the invite identified by its
 * `open_token`, then returns a 1x1 GIF. Recording is best-effort: a DB failure
 * must never break the image response. Unknown tokens are silently ignored.
 *
 * NOTE: opens are noisy — Gmail/Apple proxies pre-fetch images on delivery — so
 * the admin UI treats this as a best-effort indication, flagging proxy hits.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const openToken = params.openToken
  if (openToken) {
    const userAgent = request.headers.get("user-agent")
    await runEffect(
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        yield* repo.recordOpen(openToken, userAgent)
      }).pipe(Effect.catchAll((e) => Effect.logWarning("[invite-pixel] failed to record open", { error: String(e) }))),
    )
  }

  return pixelResponse()
}
