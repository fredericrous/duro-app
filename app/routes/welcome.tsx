import type { Route } from "./+types/welcome"
import { parseAuthHeaders } from "~/lib/auth.server"

export function meta() {
  return [{ title: "Welcome - Daddyshome" }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = parseAuthHeaders(request)
  if (!auth.user) {
    throw new Response("Unauthorized", { status: 401 })
  }
  return { user: auth.user }
}

export default function WelcomePage({ loaderData }: Route.ComponentProps) {
  const { user } = loaderData

  return (
    <main className="welcome-page">
      <div className="welcome-card">
        <div className="success-icon">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            width="64"
            height="64"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="16 10 11 15 8 12" />
          </svg>
        </div>

        <h1>Welcome, {user}!</h1>
        <p className="message">
          Your account has been created and you're all set. You now have access
          to your personal dashboard.
        </p>

        <a href="/" className="btn btn-primary">
          Go to Dashboard
        </a>
      </div>

      <style>{`
        .welcome-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 2rem; }
        .welcome-card { background: var(--color-bg-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 3rem; max-width: 480px; width: 100%; text-align: center; }
        .success-icon { color: #22c55e; margin-bottom: 1.5rem; }
        .welcome-card h1 { font-size: 1.75rem; font-weight: 700; margin-bottom: 0.75rem; }
        .message { color: var(--color-text-muted); font-size: 1rem; line-height: 1.6; margin-bottom: 2rem; }
        .btn { display: inline-block; padding: 0.75rem 2rem; border-radius: var(--radius-sm); font-size: 0.875rem; font-weight: 500; cursor: pointer; border: none; text-decoration: none; transition: background-color var(--transition); }
        .btn-primary { background: var(--color-accent); color: #fff; }
        .btn-primary:hover { background: var(--color-accent-hover); }
      `}</style>
    </main>
  )
}
