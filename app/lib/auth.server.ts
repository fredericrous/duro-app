import { Effect } from "effect"
import { redirect } from "react-router"
import { getSession, createPkceCookie } from "./session.server"
import { OidcClient } from "./services/OidcClient.server"
import { runEffect } from "./runtime.server"

export interface AuthInfo {
  user: string | null
  email: string | null
  groups: string[]
}

const DEV_AUTH: AuthInfo = { user: "dev", email: "dev@localhost", groups: ["family", "media", "lldap_admin"] }
const isDevServer = process.env.NODE_ENV === "development" && process.env.VITEST !== "true"

/**
 * Require authentication. Returns AuthInfo if the user has a valid session,
 * or throws a redirect to the OIDC login flow.
 */
export async function requireAuth(request: Request): Promise<AuthInfo> {
  const session = await getSession(request)
  if (session) {
    return { user: session.name, email: session.email, groups: session.groups }
  }

  if (isDevServer) {
    return DEV_AUTH
  }

  const { authorizationUrl, codeVerifier, state } = await runEffect(
    Effect.gen(function* () {
      const oidc = yield* OidcClient
      return yield* oidc.buildAuthRequest()
    }),
  )
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
    return { user: session.name, email: session.email, groups: session.groups }
  }
  if (isDevServer) {
    return DEV_AUTH
  }
  return { user: null, email: null, groups: [] }
}
