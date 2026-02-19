import { Outlet } from "react-router"
import type { Route } from "./+types/dashboard"
import { requireAuth } from "~/lib/auth.server"

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  return {
    user: auth.user,
    groups: auth.groups,
    isAdmin: auth.groups.includes("lldap_admin"),
  }
}

export default function DashboardLayout() {
  return <Outlet />
}
