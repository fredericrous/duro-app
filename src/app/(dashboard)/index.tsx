import { useLoaderData } from "expo-router"
import type { LoaderFunction } from "expo-server"
import type { AppDefinition } from "~/lib/apps"
import { devHomeFallback } from "../../server/dev-fallbacks"
import { Header } from "~/components/Header/Header"
import { AppGrid } from "~/components/AppGrid/AppGrid"
import { NoAccess } from "~/components/NoAccess/NoAccess"
import { CenteredCardPage } from "~/components/CenteredCardPage/CenteredCardPage"
import { PageShell } from "@duro-app/ui"

interface HomeLoaderData {
  user: string
  isAdmin: boolean
  visibleApps: AppDefinition[]
  categoryOrder: string[]
}

export const loader: LoaderFunction<HomeLoaderData> = async (request) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { requireAuth } = require("~/lib/auth.server")
  if (typeof requireAuth !== "function") return devHomeFallback

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { config } = require("~/lib/config.server")
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getVisibleApps } = require("~/lib/apps.server")
  const auth = await requireAuth(request as unknown as Request)
  return {
    user: auth.user ?? "",
    isAdmin: auth.groups.includes(config.adminGroupName),
    visibleApps: getVisibleApps(auth.groups),
    categoryOrder: config.categoryOrder,
  }
}

export default function HomePage() {
  const { user, isAdmin, visibleApps, categoryOrder } = useLoaderData<typeof loader>()

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
