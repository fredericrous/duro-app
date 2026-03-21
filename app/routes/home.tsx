import type { Route } from "./+types/home"
import { getVisibleApps } from "~/lib/apps.server"
import { config } from "~/lib/config.server"
import { Header } from "~/components/Header/Header"
import { AppGrid } from "~/components/AppGrid/AppGrid"
import { NoAccess } from "~/components/NoAccess/NoAccess"
import { CenteredCardPage } from "~/components/CenteredCardPage/CenteredCardPage"
import { PageShell } from "@duro-app/ui"
import { useRouteLoaderData } from "react-router"

export function meta() {
  return [{ title: "Home - Duro" }, { name: "description", content: "Your personal app dashboard" }]
}

export async function loader({ request }: Route.LoaderArgs) {
  // Auth is handled by the dashboard layout loader — use its data for user/groups
  // We just need the app-specific data here
  const { getAuth } = await import("~/lib/auth.server")
  const auth = await getAuth(request)
  const visibleApps = getVisibleApps(auth.groups)

  return {
    visibleApps,
    categoryOrder: config.categoryOrder,
  }
}

export default function HomePage({ loaderData }: Route.ComponentProps) {
  const { visibleApps, categoryOrder } = loaderData
  const dashboardData = useRouteLoaderData("routes/dashboard") as {
    user: string
    isAdmin: boolean
  }
  const user = dashboardData?.user ?? ""
  const isAdmin = dashboardData?.isAdmin ?? false
  const hasAccess = visibleApps.length > 0

  if (!hasAccess) {
    return (
      <CenteredCardPage>
        <NoAccess user={user} />
      </CenteredCardPage>
    )
  }

  return (
    <PageShell maxWidth="lg" header={<Header user={user} isAdmin={isAdmin} />}>
      <AppGrid apps={visibleApps} categoryOrder={categoryOrder} />
    </PageShell>
  )
}
