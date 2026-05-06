import { Outlet, redirect } from "react-router"
import type { Route } from "./+types/dashboard"
import { requireAuth } from "~/lib/auth.server"
import { checkAuthDecision } from "~/lib/auth-decision.server"
import { isFirstRun } from "~/lib/governance/bootstrap.server"
import { runEffect } from "~/lib/runtime.server"

export async function loader({ request }: Route.LoaderArgs) {
  // First-run shortcut: if there are no human users yet, send the visitor
  // to the setup wizard before the OIDC redirect that requireAuth would
  // otherwise trigger. The /admin/setup route is mounted as a sibling of
  // this layout so the redirect cannot loop.
  if (await runEffect(isFirstRun)) {
    throw redirect("/admin/setup")
  }
  const auth = await requireAuth(request)
  const adminDecision = await checkAuthDecision({ auth, application: "duro", action: "admin" })
  return {
    user: auth.user,
    email: auth.email,
    groups: auth.groups,
    isAdmin: adminDecision.allow,
  }
}

export default function DashboardLayout() {
  return <Outlet />
}
