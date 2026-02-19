import { redirect } from "react-router"
import type { Route } from "./+types/auth.logout"
import { clearSessionCookie } from "~/lib/session.server"
import { getEndSessionUrl } from "~/lib/oidc.server"

export async function loader(_args: Route.LoaderArgs) {
  const endSessionUrl = await getEndSessionUrl()
  const postLogoutUri = new URL(process.env.OIDC_REDIRECT_URI!).origin

  const logoutUrl = new URL(endSessionUrl)
  logoutUrl.searchParams.set("post_logout_redirect_uri", postLogoutUri)

  throw redirect(logoutUrl.toString(), {
    headers: { "Set-Cookie": clearSessionCookie() },
  })
}
