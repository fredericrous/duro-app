import { useCallback } from "react"
import { Outlet, useLocation, useNavigate, useRouteLoaderData } from "react-router"
import { useTranslation } from "react-i18next"
import type { Route } from "./+types/settings"
import { requireAuth } from "~/lib/auth.server"
import { config } from "~/lib/config.server"
import { Icon, SideNav } from "@duro-app/ui"
import { Header } from "~/components/Header/Header"
import { AppShell, type AppShellNavProps } from "~/components/AppShell/AppShell"

export function meta() {
  return [{ title: "Settings - Duro" }]
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAuth(request)
  // The Security section only exists when an Authelia portal is configured;
  // gate the nav item on it so we don't link to a dead section.
  return { hasSecurity: Boolean(config.autheliaUrl), hasGit: Boolean(config.forgejoUrl) }
}

function deriveActiveValue(pathname: string): string {
  if (pathname === "/settings" || pathname === "/settings/") return "general"
  const segment = pathname.replace("/settings/", "").split("/")[0]
  return segment || "general"
}

const navMap: Record<string, string> = {
  general: "/settings",
  activity: "/settings/activity",
  "api-keys": "/settings/api-keys",
  git: "/settings/git",
  security: "/settings/security",
}

export default function SettingsLayout({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()

  const dashboardData = useRouteLoaderData("routes/dashboard") as { user: string; isAdmin: boolean } | undefined

  const activeValue = deriveActiveValue(location.pathname)

  const nav = useCallback(
    ({ onSelect }: AppShellNavProps) => (
      <SideNav.Root
        value={activeValue}
        onValueChange={(value) => {
          const path = navMap[value]
          if (path) navigate(path)
          onSelect()
        }}
      >
        <SideNav.Section label={t("settings.nav.title", "Settings")}>
          <SideNav.Item value="general" icon={<Icon name="user-plus" size="md" />}>
            {t("settings.nav.general", "General")}
          </SideNav.Item>
          <SideNav.Item value="activity" icon={<Icon name="clock" size="md" />}>
            {t("settings.nav.activity", "Activity")}
          </SideNav.Item>
          <SideNav.Item value="api-keys" icon={<Icon name="key" size="md" />}>
            {t("settings.nav.apiKeys", "API keys")}
          </SideNav.Item>
          {loaderData.hasGit && (
            <SideNav.Item value="git" icon={<Icon name="git-branch" size="md" />}>
              {t("settings.nav.git", "Git access")}
            </SideNav.Item>
          )}
          {loaderData.hasSecurity && (
            <SideNav.Item value="security" icon={<Icon name="shield" size="md" />}>
              {t("settings.nav.security", "Security")}
            </SideNav.Item>
          )}
        </SideNav.Section>
      </SideNav.Root>
    ),
    [activeValue, loaderData.hasGit, loaderData.hasSecurity, navigate, t],
  )

  return (
    <AppShell
      header={<Header user={dashboardData?.user ?? ""} isAdmin={dashboardData?.isAdmin ?? false} />}
      nav={nav}
      navTitle={t("settings.nav.title", "Settings")}
      menuLabel={t("settings.nav.menu", "Menu")}
      closeLabel={t("common.close", "Close")}
    >
      <Outlet />
    </AppShell>
  )
}
