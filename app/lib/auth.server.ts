import { Effect } from "effect"
import { getSession, createPkceCookie } from "./session.server"
import { OidcClient } from "./services/OidcClient.server"
import { runEffect } from "./runtime.server"
import { resolvePendingCertInvite } from "./workflows/invite.server"
import { isRestricted, presentedCertStatus, type PresentedCertStatus } from "./workflows/presented-cert.server"

export interface AuthInfo {
  /**
   * OIDC subject (stable per-user identifier). This is what
   * principals.external_id is keyed on — use this for any DB
   * lookup of the actor, never `user` (display name, not unique).
   */
  sub: string | null
  /** Display name. Useful for UI strings only. */
  user: string | null
  email: string | null
  groups: string[]
}

const DEV_AUTH: AuthInfo = {
  sub: "dev",
  user: "dev",
  email: "dev@localhost",
  groups: ["family", "media", "lldap_admin"],
}
const isDevServer = process.env.NODE_ENV === "development" && process.env.VITEST !== "true"

/**
 * When an unauthenticated request already carries a valid client certificate
 * whose invite has no account yet, send it straight to `/setup` instead of the
 * OIDC login it could never complete. This is the automatic rescue for an
 * invitee who installed the cert but opened `home` directly (no invite token in
 * hand). Runs only when there is no session and an Envoy-set XFCC header is
 * present, so it never touches the authenticated hot path, dev, or non-mTLS
 * hosts. Returns a 302 Response to throw, or null to fall through to OIDC.
 */
async function pendingCertRedirect(request: Request): Promise<Response | null> {
  const xfcc = request.headers.get("x-forwarded-client-cert")
  if (!xfcc) return null
  const resolved = await runEffect(resolvePendingCertInvite(xfcc).pipe(Effect.orDie))
  if (resolved.kind !== "pending") return null
  // Relative, same-origin: the request is already on the mTLS host.
  return new Response(null, { status: 302, headers: { Location: "/setup" } })
}

/** Paths a device presenting its revoked certificate may still reach. */
function reachableWhileRevoked(pathname: string): boolean {
  // React Router's single fetch suffixes data requests with ".data".
  const path = pathname.endsWith(".data") ? pathname.slice(0, -".data".length) : pathname
  return path === "/devices" || path.startsWith("/auth/")
}

/**
 * One navigation calls requireAuth/getAuth several times (the dashboard layout
 * and each nested route): the lookup runs once per Request object.
 */
const statusByRequest = new WeakMap<Request, Promise<PresentedCertStatus>>()

function presentedStatus(request: Request, user: string): Promise<PresentedCertStatus> {
  let status = statusByRequest.get(request)
  if (!status) {
    status = runEffect(presentedCertStatus(request.headers.get("x-forwarded-client-cert"), user))
    statusByRequest.set(request, status)
  }
  return status
}

/**
 * A device presenting one of its user's own revoked certificates may do one
 * thing on duro: get a new one. duro-https has no CRL (it is the way back in),
 * so the revoked certificate still reaches the app; everything but /devices
 * (and signing out) sends it there, and any write is refused. Applied by BOTH
 * requireAuth and getAuth: an action or a `?_routes=` data request can reach a
 * route without its layout, and many routes only call getAuth. The person's
 * decision, 2026-11-26 (plan 2026-11-26-revoked-cert-notice).
 *
 * Fails soft when the lookup itself is unavailable (a slow query must not lock
 * everyone out); a revoked row whose CA check did not answer is restricted.
 * /devices never pays for the lookup; elsewhere it is one indexed query, the
 * CA check only on a hit, once per request, under 300 ms (presented-cert.server).
 */
async function isConfined(request: Request, auth: AuthInfo): Promise<boolean> {
  if (!request.headers.get("x-forwarded-client-cert") || !auth.user) return false
  if (reachableWhileRevoked(new URL(request.url).pathname)) return false
  return isRestricted(await presentedStatus(request, auth.user))
}

const isRead = (request: Request) => ["GET", "HEAD"].includes(request.method.toUpperCase())

const refusedWrite = () =>
  new Response("This device's certificate is revoked: get a new one from Devices.", { status: 403 })

/** requireAuth: a confined device is sent to /devices, and its writes are refused. */
async function confineRevokedDevice(request: Request, auth: AuthInfo): Promise<void> {
  if (!(await isConfined(request, auth))) return
  if (isRead(request)) throw new Response(null, { status: 302, headers: { Location: "/devices" } })
  throw refusedWrite()
}

/**
 * Require authentication. Returns AuthInfo if the user has a valid session,
 * or throws a redirect to the OIDC login flow. A device presenting its user's
 * revoked certificate is confined to /devices (`confineRevokedDevice`).
 */
export async function requireAuth(request: Request): Promise<AuthInfo> {
  const session = await getSession(request)
  if (session) {
    const auth = { sub: session.sub, user: session.name, email: session.email, groups: session.groups }
    await confineRevokedDevice(request, auth)
    return auth
  }

  if (isDevServer) {
    await confineRevokedDevice(request, DEV_AUTH)
    return DEV_AUTH
  }

  const certRedirect = await pendingCertRedirect(request)
  if (certRedirect) throw certRedirect

  const { authorizationUrl, codeVerifier, state } = await runEffect(
    Effect.gen(function* () {
      const oidc = yield* OidcClient
      return yield* oidc.buildAuthRequest()
    }).pipe(Effect.orDie), // OIDC misconfig/outage → 500; no in-band fallback exists
  )
  const returnUrl = new URL(request.url).pathname
  const pkceCookie = await createPkceCookie({ codeVerifier, state, returnUrl })

  throw new Response(null, {
    status: 302,
    headers: {
      Location: authorizationUrl.toString(),
      "Set-Cookie": pkceCookie,
    },
  })
}

/**
 * Get auth info from session without redirecting to sign in. Use in child
 * routes where the parent layout already called requireAuth. A device
 * presenting its user's revoked certificate is confined to /devices here too,
 * because an action or a `?_routes=` data request reaches a route without its
 * layout: its writes get a 403, and its reads see no one signed in (the
 * existing no-session answer, so a loader that streams the result in a promise
 * never rejects it unhandled).
 */
export async function getAuth(request: Request): Promise<AuthInfo> {
  const session = await getSession(request)
  const signedOut: AuthInfo = { sub: null, user: null, email: null, groups: [] }
  const user = session
    ? { sub: session.sub, user: session.name, email: session.email, groups: session.groups }
    : isDevServer
      ? DEV_AUTH
      : null
  if (!user) return signedOut
  if (!(await isConfined(request, user))) return user
  if (isRead(request)) return signedOut
  throw refusedWrite()
}
