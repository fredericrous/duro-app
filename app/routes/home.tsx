import { useTranslation } from "react-i18next"
import type { Route } from "./+types/home"
import { getAuth } from "~/lib/auth.server"
import { getVisibleApps } from "~/lib/apps.server"
import { AppGrid } from "~/components/AppGrid/AppGrid"
import { NoAccess } from "~/components/NoAccess/NoAccess"
import styles from "./home.module.css"

export function meta() {
  return [{ title: "Home - Duro" }, { name: "description", content: "Your personal app dashboard" }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await getAuth(request)
  const visibleApps = getVisibleApps(auth.groups)

  return {
    user: auth.user,
    visibleApps,
  }
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { user, visibleApps } = loaderData

  return (
    <main className={styles.page}>
      {visibleApps.length > 0 ? <AppGrid apps={visibleApps} /> : <NoAccess user={user} />}
    </main>
  )
}
