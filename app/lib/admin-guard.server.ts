import { getAuth } from "./auth.server"
import type { AuthInfo } from "./auth.server"
import { checkAuthDecision } from "./auth-decision.server"
import { isOriginAllowed } from "./config.server"

/**
 * Self-gate an admin route.
 *
 * React Router single fetch lets a client run one route's loader/action in
 * isolation via `?_routes=<id>`, which skips every ancestor loader — so the
 * admin gate in `admin.tsx` (a parent loader) can be bypassed and CANNOT be
 * relied on for authorization. Every admin loader AND action must call this
 * itself. See admin-authz memory / the audit for the exploit details.
 */
export async function requireAdmin(request: Request): Promise<AuthInfo> {
  const auth = await getAuth(request)
  const decision = await checkAuthDecision({ auth, application: "duro", action: "admin" })
  if (!decision.allow) throw new Response("Forbidden", { status: 403 })
  return auth
}

/**
 * Gate an admin *action* (state-changing request). In addition to the admin
 * check, this rejects requests whose Origin is missing or cross-site — a
 * missing Origin on a mutation is treated as deny (unlike `isOriginAllowed`,
 * which allows a null Origin for same-origin GET navigations).
 */
export async function requireAdminAction(request: Request): Promise<AuthInfo> {
  const auth = await requireAdmin(request)
  const origin = request.headers.get("Origin")
  if (!origin || !isOriginAllowed(origin)) {
    throw new Response("Invalid origin", { status: 403 })
  }
  return auth
}
