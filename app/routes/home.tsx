import type { Route } from "./+types/home";
import { parseAuthHeaders } from "~/lib/auth.server";
import { getVisibleApps } from "~/lib/apps.server";
import { AppGrid } from "~/components/AppGrid/AppGrid";
import { NoAccess } from "~/components/NoAccess/NoAccess";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Home - Duro" },
    { name: "description", content: "Your personal app dashboard" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = parseAuthHeaders(request);
  const visibleApps = getVisibleApps(auth.groups);

  return {
    user: auth.user,
    groups: auth.groups,
    visibleApps,
    isAdmin: auth.groups.includes("lldap_admin"),
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { user, visibleApps, isAdmin } = loaderData;

  return (
    <main className="page">
      <header className="header">
        <h1 className="title">Duro</h1>
        <div className="header-right">
          {isAdmin && <a href="/users" className="admin-link">Users</a>}
          {user && <span className="user">Welcome, {user}</span>}
        </div>
      </header>

      {visibleApps.length > 0 ? (
        <AppGrid apps={visibleApps} />
      ) : (
        <NoAccess user={user} />
      )}

      <style>{`
        .page {
          max-width: 1200px;
          margin: 0 auto;
          padding: 2rem 1.5rem;
        }

        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 2.5rem;
          flex-wrap: wrap;
          gap: 1rem;
        }

        .title {
          font-size: 1.75rem;
          font-weight: 700;
        }

        .header-right {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .admin-link {
          font-size: 0.8rem;
          color: var(--color-text-muted);
          transition: color var(--transition);
        }

        .admin-link:hover {
          color: var(--color-accent);
        }

        .user {
          font-size: 0.875rem;
          color: var(--color-text-muted);
        }
      `}</style>
    </main>
  );
}
