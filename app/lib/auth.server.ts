import { redirect } from "react-router"
import { getSession, createPkceCookie } from "./session.server"
import { buildAuthRequest } from "./oidc.server"

export interface AuthInfo {
  user: string | null
  groups: string[]
}

const DEV_AUTH: AuthInfo = { user: "dev", groups: ["family", "media", "lldap_admin"] }
const isDevServer = import.meta.env.DEV && !import.meta.env.VITEST

/**
 * Require authentication. Returns AuthInfo if the user has a valid session,
 * or throws a redirect to the OIDC login flow.
 */
export async function requireAuth(request: Request): Promise<AuthInfo> {
  const session = await getSession(request)
  if (session) {
    return { user: session.name, groups: session.groups }
  }

  if (isDevServer) {
    return DEV_AUTH
  }

  const { authorizationUrl, codeVerifier, state } = await buildAuthRequest()
  const returnUrl = new URL(request.url).pathname
  const pkceCookie = await createPkceCookie({ codeVerifier, state, returnUrl })

  throw redirect(authorizationUrl.toString(), {
    headers: { "Set-Cookie": pkceCookie },
  })
}

/**
 * Get auth info from session without redirecting.
 * Use in child routes where the parent layout already called requireAuth.
 */
export async function getAuth(request: Request): Promise<AuthInfo> {
  const session = await getSession(request)
  if (session) {
    return { user: session.name, groups: session.groups }
  }
  if (isDevServer) {
    return DEV_AUTH
  }
  return { user: null, groups: [] }
}
