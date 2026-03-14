import { Effect } from "effect"
import { redirect } from "react-router"
import type { Route } from "./+types/auth.logout"
import { OidcClient } from "~/lib/services/OidcClient.server"
import { runEffect } from "~/lib/runtime.server"
import { clearSessionCookie } from "~/lib/session.server"

export async function loader(_args: Route.LoaderArgs) {
  const endSessionUrl = await runEffect(
    Effect.gen(function* () {
      const oidc = yield* OidcClient
      return yield* oidc.getEndSessionUrl()
    }),
  )
  const postLogoutUri = new URL(process.env.OIDC_REDIRECT_URI!).origin

  const logoutUrl = new URL(endSessionUrl)
  logoutUrl.searchParams.set("post_logout_redirect_uri", postLogoutUri)

  throw redirect(logoutUrl.toString(), {
    headers: { "Set-Cookie": clearSessionCookie() },
  })
}
