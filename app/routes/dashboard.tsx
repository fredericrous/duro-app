import { Outlet } from "react-router"
import type { Route } from "./+types/dashboard"
import { requireAuth } from "~/lib/auth.server"
import { config } from "~/lib/config.server"

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  return {
    user: auth.user,
    email: auth.email,
    groups: auth.groups,
    isAdmin: auth.groups.includes(config.adminGroupName),
  }
}

export default function DashboardLayout() {
  return <Outlet />
}
