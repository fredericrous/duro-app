import { Outlet } from "react-router"
import type { Route } from "./+types/dashboard"
import { requireAuth } from "~/lib/auth.server"
import { checkAuthDecision } from "~/lib/auth-decision.server"

export async function loader({ request }: Route.LoaderArgs) {
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
