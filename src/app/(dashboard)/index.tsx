import { useLoaderData } from "expo-router"
import type { LoaderFunction } from "expo-server"
import type { AppDefinition } from "~/lib/apps"
import { Header } from "~/components/Header/Header"
import { AppGrid } from "~/components/AppGrid/AppGrid"
import { NoAccess } from "~/components/NoAccess/NoAccess"
import { CenteredCardPage } from "~/components/CenteredCardPage/CenteredCardPage"
import { css, html } from "react-strict-dom"

const styles = css.create({
  page: {
    maxWidth: 1200,
    margin: "0 auto",
    padding: "32px 24px",
  },
})

interface HomeLoaderData {
  user: string
  isAdmin: boolean
  visibleApps: AppDefinition[]
  categoryOrder: string[]
}

export const loader: LoaderFunction<HomeLoaderData> = async (request) => {
  try {
    const { requireAuth } = await import("~/lib/auth.server")
    const { getVisibleApps } = await import("~/lib/apps.server")
    const { config } = await import("~/lib/config.server")

    const auth = await requireAuth(request as unknown as Request)
    const visibleApps = getVisibleApps(auth.groups)

    return {
      user: auth.user ?? "",
      isAdmin: auth.groups.includes(config.adminGroupName),
      visibleApps,
      categoryOrder: config.categoryOrder,
    }
  } catch (e) {
    if (e instanceof Response) throw e
    // Dev mode fallback
    return { user: "dev", isAdmin: true, visibleApps: [], categoryOrder: [] }
  }
}

export default function HomePage() {
  const { user, isAdmin, visibleApps, categoryOrder } = useLoaderData<typeof loader>()

  const hasAccess = visibleApps.length > 0

  return (
    <>
      <Header user={user} isAdmin={isAdmin} showMenu={hasAccess} />
      {hasAccess ? (
        <html.main style={styles.page}>
          <AppGrid apps={visibleApps} categoryOrder={categoryOrder} />
        </html.main>
      ) : (
        <CenteredCardPage>
          <NoAccess user={user} />
        </CenteredCardPage>
      )}
    </>
  )
}
