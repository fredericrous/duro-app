import type { ReactNode } from "react"
import { Links, Meta, Outlet, Scripts, ScrollRestoration, isRouteErrorResponse, useRouteLoaderData } from "react-router"
import { useTranslation } from "react-i18next"
import type { Route } from "./+types/root"
import { resolveLocale } from "~/lib/i18n.server"
import "./styles/global.css"

export async function loader({ request }: Route.LoaderArgs) {
  const locale = resolveLocale(request)
  return { locale }
}

export function Layout({ children }: { children: ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root")
  const locale = data?.locale ?? "en"

  return (
    <html lang={locale}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function App() {
  return <Outlet />
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t } = useTranslation()
  let message = t("error.title")
  let details = t("error.details")

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? t("error.404") : "Error"
    details = error.status === 404 ? t("error.404msg") : error.statusText || details
  } else if (error instanceof Error) {
    details = error.message
  }

  return (
    <main className="error-container">
      <h1>{message}</h1>
      <p>{details}</p>
    </main>
  )
}
