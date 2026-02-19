import { redirect } from "react-router"
import type { Route } from "./+types/auth.callback"
import { exchangeCode } from "~/lib/oidc.server"
import {
  getPkceData,
  createSessionCookie,
  clearPkceCookie,
} from "~/lib/session.server"

export async function loader({ request }: Route.LoaderArgs) {
  const pkce = await getPkceData(request)
  if (!pkce) {
    throw redirect("/")
  }

  // Reconstruct callback URL with the registered redirect_uri origin
  // (behind reverse proxy, request.url may have a localhost origin)
  const reqUrl = new URL(request.url)
  const callbackUrl = new URL(process.env.OIDC_REDIRECT_URI!)
  callbackUrl.search = reqUrl.search

  const user = await exchangeCode(callbackUrl, pkce.codeVerifier, pkce.state)

  const sessionCookie = await createSessionCookie({
    sub: user.sub,
    name: user.name,
    email: user.email,
    groups: user.groups,
  })

  const returnUrl = pkce.returnUrl || "/"
  const headers = new Headers()
  headers.append("Set-Cookie", sessionCookie)
  headers.append("Set-Cookie", clearPkceCookie())

  throw redirect(returnUrl, { headers })
}
