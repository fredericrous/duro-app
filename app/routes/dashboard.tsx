import { Outlet } from "react-router"
import type { Route } from "./+types/dashboard"
import { requireAuth } from "~/lib/auth.server"
import { config } from "~/lib/config.server"
import { Header } from "~/components/Header/Header"

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  return {
    user: auth.user,
    groups: auth.groups,
    isAdmin: auth.groups.includes(config.adminGroupName),
  }
}

export default function DashboardLayout({ loaderData }: Route.ComponentProps) {
  const { user, isAdmin } = loaderData

  return (
    <>
      <Header user={user ?? ""} isAdmin={isAdmin} />
      <Outlet />
    </>
  )
}
