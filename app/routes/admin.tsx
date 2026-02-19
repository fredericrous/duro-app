import { Link, NavLink, Outlet } from "react-router"
import type { Route } from "./+types/admin"
import { getAuth } from "~/lib/auth.server"
import styles from "./admin.module.css"

export function meta() {
  return [{ title: "Admin - Duro" }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await getAuth(request)
  if (!auth.groups.includes("lldap_admin")) {
    throw new Response("Forbidden", { status: 403 })
  }
  return { user: auth.user }
}

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  const { user } = loaderData

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Admin</h1>
          <Link to="/" className={styles.backLink}>
            Back to Dashboard
          </Link>
        </div>
        <span className={styles.userLabel}>{user}</span>
      </header>

      <nav className={styles.tabs}>
        <NavLink to="/admin" end className={({ isActive }) => `${styles.tab} ${isActive ? styles.tabActive : ""}`}>
          Users
        </NavLink>
      </nav>

      <Outlet />
    </main>
  )
}
