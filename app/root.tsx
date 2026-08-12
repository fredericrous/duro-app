import { useEffect, type ReactNode } from "react"
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  data,
  isRouteErrorResponse,
  useRouteLoaderData,
} from "react-router"
import { useTranslation } from "react-i18next"
import { css, html } from "react-strict-dom"
import { ActionBarProvider, Heading, Stack, Text, ThemeProvider, ToastProvider } from "@duro-app/ui"
import { colors } from "@duro-app/tokens/tokens/colors.css"
import { spacing } from "@duro-app/tokens/tokens/spacing.css"
import { DevToolbar } from "~/components/DevToolbar/DevToolbar"
import type { Route } from "./+types/root"
import { resolveLocale } from "~/lib/i18n.server"
import {
  hasThemeCookie,
  isThemePreference,
  resolveTheme,
  resolveThemePreference,
  themeCookieHeader,
  type ThemePreference,
} from "~/lib/theme.server"
import { getSession } from "~/lib/session.server"
import { PreferencesRepo } from "~/lib/services/PreferencesRepo.server"
import { runEffect } from "~/lib/runtime.server"
import { useResolvedTheme } from "~/hooks/useResolvedTheme"
import { Effect } from "effect"
import "@duro-app/ui/dist/index.css"
import "./styles/global.css"
import "./styles/strict.css"

const isDev = process.env.NODE_ENV === "development"

export async function loader({ request }: Route.LoaderArgs) {
  const locale = resolveLocale(request)
  let themePreference = resolveThemePreference(request)
  let theme = resolveTheme(request)

  // Cross-device read-through: no theme cookie yet, but the user may have a
  // stored preference from another device. Root serves public routes (invite,
  // recovery, health, auth callback) so this must never redirect or throw —
  // read the session only if present and swallow any failure.
  if (!hasThemeCookie(request)) {
    const stored = await (async () => {
      const session = await getSession(request).catch(() => null)
      if (!session?.name) return null
      const value = await runEffect(
        Effect.gen(function* () {
          const prefs = yield* PreferencesRepo
          return yield* prefs.getTheme(session.name)
        }),
      ).catch(() => null)
      return isThemePreference(value) ? value : null
    })()

    if (stored) {
      themePreference = stored
      theme = stored === "system" ? theme : stored
      return data({ locale, theme, themePreference }, { headers: { "Set-Cookie": themeCookieHeader(stored) } })
    }
  }

  return { locale, theme, themePreference }
}

function MaybeDevToolbar({ children }: { children: ReactNode }) {
  if (!isDev) return <>{children}</>
  return <DevToolbar>{children}</DevToolbar>
}

/**
 * Runs before first paint: resolves the theme preference against the OS
 * scheme, applies it to <html data-theme> (which drives the :root/body CSS
 * variables — the DS subtree gets its theme via <ThemeProvider>), and
 * refreshes the __duro_scheme cookie so the NEXT SSR paint resolves "system"
 * correctly server-side.
 */
const PRE_PAINT_THEME_SCRIPT = `(function(){try{var m=document.cookie.match(/__duro_theme=([^;]+)/);var p=m?m[1]:"dark";var s=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";document.cookie="__duro_scheme="+s+"; Path=/; SameSite=Lax; Max-Age=31536000";var r=p==="system"?s:(p==="light"?"light":"dark");document.documentElement.dataset.theme=r}catch(e){}})()`

export function Layout({ children }: { children: ReactNode }) {
  "use no memo"
  const loaderData = useRouteLoaderData<typeof loader>("root")
  const locale = loaderData?.locale ?? "en"
  const ssrTheme = loaderData?.theme ?? "dark"
  const themePreference: ThemePreference = loaderData?.themePreference ?? ssrTheme

  // The concrete theme fed to BOTH html[data-theme] and <ThemeProvider>.
  // For "system" it follows the OS scheme live.
  const theme = useResolvedTheme(ssrTheme, themePreference)

  // Keep html[data-theme] in sync after client-side changes (OS scheme flip,
  // stale scheme-cookie correction). First paint is handled by the SSR attr +
  // the pre-paint script.
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  return (
    <html lang={locale} data-theme={theme} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PRE_PAINT_THEME_SCRIPT }} />
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
    <html.main style={styles.errorContainer}>
      <Stack gap="md" align="center">
        <Heading level={1}>{message}</Heading>
        <Text variant="bodyLg" color="muted" align="center">
          {details}
        </Text>
        <html.a href="/" style={styles.errorLink}>
          {t("error.goHome")}
        </html.a>
      </Stack>
    </html.main>
  )
}

const styles = css.create({
  errorContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
    textAlign: "center",
    padding: spacing.xl,
  },
  errorLink: {
    color: colors.accent,
    textDecoration: "underline",
  },
})
