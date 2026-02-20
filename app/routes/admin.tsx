import { NavLink, Outlet } from "react-router"
import { useTranslation } from "react-i18next"
import type { Route } from "./+types/admin"
import { getAuth } from "~/lib/auth.server"
import { config } from "~/lib/config.server"
import styles from "./admin.module.css"

export function meta() {
  return [{ title: "Admin - Duro" }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await getAuth(request)
  if (!auth.groups.includes(config.adminGroupName)) {
    throw new Response("Forbidden", { status: 403 })
  }
  return {}
}

export default function AdminLayout() {
  const { t } = useTranslation()

  return (
    <main className={styles.page}>
      <nav className={styles.tabs}>
        <NavLink to="/admin" end className={({ isActive }) => `${styles.tab} ${isActive ? styles.tabActive : ""}`}>
          {t("admin.tabs.invites")}
        </NavLink>
        <NavLink to="/admin/users" className={({ isActive }) => `${styles.tab} ${isActive ? styles.tabActive : ""}`}>
          {t("admin.tabs.users")}
        </NavLink>
      </nav>

      <Outlet />
    </main>
  )
}
