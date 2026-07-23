import type { ReactNode } from "react"
import { Links, Meta, Outlet, Scripts, ScrollRestoration, isRouteErrorResponse, useRouteLoaderData } from "react-router"
import { useTranslation } from "react-i18next"
import { ActionBarProvider, ThemeProvider, ToastProvider } from "@duro-app/ui"
import { DevToolbar } from "~/components/DevToolbar/DevToolbar"
import type { Route } from "./+types/root"
import { resolveLocale } from "~/lib/i18n.server"
import { resolveTheme } from "~/lib/theme.server"
import "@duro-app/ui/dist/index.css"
import "./styles/global.css"
import "./styles/strict.css"

const isDev = process.env.NODE_ENV === "development"

export async function loader({ request }: Route.LoaderArgs) {
  const locale = resolveLocale(request)
  const theme = resolveTheme(request)
  return { locale, theme }
}

function MaybeDevToolbar({ children }: { children: ReactNode }) {
  if (!isDev) return <>{children}</>
  return <DevToolbar>{children}</DevToolbar>
}

export function Layout({ children }: { children: ReactNode }) {
  "use no memo"
  const data = useRouteLoaderData<typeof loader>("root")
  const locale = data?.locale ?? "en"
  const theme = data?.theme ?? "dark"

  return (
    <html lang={locale}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <Meta />
        <Links />
      </head>
      <body>
        <ThemeProvider theme={theme}>
          <ToastProvider>
            <ActionBarProvider>
              <MaybeDevToolbar>{children}</MaybeDevToolbar>
            </ActionBarProvider>
          </ToastProvider>
        </ThemeProvider>
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
    if (error.status === 404) {
      message = t("error.404")
      details = t("error.404msg")
    } else {
      message = t("error.generic")
      // statusText is developer-controlled (e.g. "Forbidden"), safe to show.
      details = error.statusText || t("error.details")
    }
  } else if (process.env.NODE_ENV !== "production" && error instanceof Error) {
    // Surface the real message only outside production — a raw internal error
    // message must never leak to end users.
    details = error.message
  }

  return (
    <main className="error-container">
      <h1>{message}</h1>
      <p>{details}</p>
      <a href="/">{t("error.goHome")}</a>
    </main>
  )
}
