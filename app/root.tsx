import type { ReactNode } from "react"
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteLoaderData,
} from "react-router"
import { useTranslation } from "react-i18next"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "@duro-app/ui"
import { DevToolbar } from "~/components/DevToolbar/DevToolbar"
import type { Route } from "./+types/root"
import { resolveLocale } from "~/lib/i18n.server"
import "@duro-app/ui/dist/index.css"
import "./styles/global.css"
import "./styles/strict.css"

const queryClient = new QueryClient()
const isDev = process.env.NODE_ENV === "development"

export async function loader({ request }: Route.LoaderArgs) {
  const locale = resolveLocale(request)
  return { locale }
}

function MaybeDevToolbar({ children }: { children: ReactNode }) {
  if (!isDev) return <>{children}</>
  return <DevToolbar>{children}</DevToolbar>
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
        <QueryClientProvider client={queryClient}>
          <ThemeProvider theme="dark">
            <MaybeDevToolbar>{children}</MaybeDevToolbar>
          </ThemeProvider>
        </QueryClientProvider>
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
