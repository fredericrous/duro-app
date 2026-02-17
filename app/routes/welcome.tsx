import type { Route } from "./+types/welcome"
import { parseAuthHeaders } from "~/lib/auth.server"
import { ButtonLink } from "~/components/ButtonLink/ButtonLink"
import styles from "./welcome.module.css"

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
    <main className={styles.page}>
      <div className={styles.card}>
        <div className={styles.successIcon}>
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
        <p className={styles.message}>
          Your account has been created and you're all set. You now have access
          to your personal dashboard.
        </p>

        <ButtonLink to="/">Go to Dashboard</ButtonLink>
      </div>
    </main>
  )
}
