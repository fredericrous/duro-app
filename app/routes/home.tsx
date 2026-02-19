import { Link } from "react-router";
import type { Route } from "./+types/home";
import { getAuth } from "~/lib/auth.server";
import { getVisibleApps } from "~/lib/apps.server";
import { AppGrid } from "~/components/AppGrid/AppGrid";
import { NoAccess } from "~/components/NoAccess/NoAccess";
import styles from "./home.module.css";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Home - Duro" },
    { name: "description", content: "Your personal app dashboard" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await getAuth(request);
  const visibleApps = getVisibleApps(auth.groups);

  return {
    user: auth.user,
    visibleApps,
    isAdmin: auth.groups.includes("lldap_admin"),
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { user, visibleApps, isAdmin } = loaderData;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Duro</h1>
        <div className={styles.headerRight}>
          {isAdmin && <Link to="/admin" className={styles.adminLink}>Admin</Link>}
          {user && (
            <>
              <span className={styles.user}>Welcome, {user}</span>
              <Link to="/auth/logout" className={styles.adminLink}>Logout</Link>
            </>
          )}
        </div>
      </header>

      {visibleApps.length > 0 ? (
        <AppGrid apps={visibleApps} />
      ) : (
        <NoAccess user={user} />
      )}
    </main>
  );
}
