import { useState, useCallback } from "react"
import { Outlet, useLocation, useNavigate, useRouteLoaderData } from "react-router"
import { css, html } from "react-strict-dom"
import { useTranslation } from "react-i18next"
import type { Route } from "./+types/settings"
import { requireAuth } from "~/lib/auth.server"
import { config } from "~/lib/config.server"
import { Button, Drawer, Icon, PageShell, SideNav, Stack } from "@duro-app/ui"
import { Header } from "~/components/Header/Header"
import { useMediaQuery } from "~/hooks/useMediaQuery"
import { spacing } from "@duro-app/tokens/tokens/spacing.css"

const styles = css.create({
  outerFlex: {
    display: "flex",
    minHeight: 0,
    flex: 1,
  },
  pageWrap: {
    flex: 1,
    minWidth: 0,
    maxWidth: "100%",
    overflowX: "clip",
  },
  layoutRow: {
    display: "flex",
    flex: 1,
    minHeight: 0,
    gap: spacing.lg,
  },
  sideNav: {
    width: 220,
    flexShrink: 0,
  },
  mainContent: {
    flex: 1,
    minWidth: 0,
    paddingTop: spacing.md,
  },
  mobileHeader: {
    display: "flex",
    alignItems: "center",
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
})

export function meta() {
  return [{ title: "Settings - Duro" }]
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAuth(request)
  // The Security section only exists when an Authelia portal is configured;
  // gate the nav item on it so we don't link to a dead section.
  return { hasSecurity: Boolean(config.autheliaUrl) }
}

function deriveActiveValue(pathname: string): string {
  if (pathname === "/settings" || pathname === "/settings/") return "general"
  const segment = pathname.replace("/settings/", "").split("/")[0]
  return segment || "general"
}

const navMap: Record<string, string> = {
  general: "/settings",
  certificate: "/settings/certificate",
  "api-keys": "/settings/api-keys",
  security: "/settings/security",
}

export default function SettingsLayout({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const isWide = useMediaQuery("(min-width: 768px)", true)
  const [navDrawerOpen, setNavDrawerOpen] = useState(false)

  const dashboardData = useRouteLoaderData("routes/dashboard") as { user: string; isAdmin: boolean } | undefined

  const activeValue = deriveActiveValue(location.pathname)

  const handleValueChange = useCallback(
    (value: string) => {
      const path = navMap[value]
      if (path) navigate(path)
      setNavDrawerOpen(false)
    },
    [navigate],
  )

  const navContent = (
    <SideNav.Root value={activeValue} onValueChange={handleValueChange}>
      <SideNav.Section label={t("settings.nav.title", "Settings")}>
        <SideNav.Item value="general" icon={<Icon name="user-plus" size={18} />}>
          {t("settings.nav.general", "General")}
        </SideNav.Item>
        <SideNav.Item value="certificate" icon={<Icon name="lock" size={18} />}>
          {t("settings.nav.certificate", "Certificate")}
        </SideNav.Item>
        <SideNav.Item value="api-keys" icon={<Icon name="key" size={18} />}>
          {t("settings.nav.apiKeys", "API keys")}
        </SideNav.Item>
        {loaderData.hasSecurity && (
          <SideNav.Item value="security" icon={<Icon name="shield" size={18} />}>
            {t("settings.nav.security", "Security")}
          </SideNav.Item>
        )}
      </SideNav.Section>
    </SideNav.Root>
  )

  return (
    <html.div style={styles.outerFlex}>
      <html.div style={styles.pageWrap}>
        <PageShell
          maxWidth="lg"
          header={<Header user={dashboardData?.user ?? ""} isAdmin={dashboardData?.isAdmin ?? false} />}
        >
          {isWide ? (
            <html.div style={styles.layoutRow}>
              <html.div style={styles.sideNav}>{navContent}</html.div>
              <html.div style={styles.mainContent}>
                <Outlet />
              </html.div>
            </html.div>
          ) : (
            <>
              <html.div style={styles.mobileHeader}>
                <Button variant="secondary" size="small" onClick={() => setNavDrawerOpen(true)}>
                  {t("settings.nav.menu", "Menu")}
                </Button>
              </html.div>
              <Stack gap="lg">
                <Outlet />
              </Stack>
            </>
          )}
        </PageShell>
      </html.div>

      <Drawer.Root open={navDrawerOpen} onOpenChange={setNavDrawerOpen} anchor="left">
        <Drawer.Portal size="sm">
          <Drawer.Header>
            <Drawer.Title>{t("settings.nav.title", "Settings")}</Drawer.Title>
            <Drawer.Close aria-label={t("common.close", "Close")} />
          </Drawer.Header>
          <Drawer.Body>{navContent}</Drawer.Body>
        </Drawer.Portal>
      </Drawer.Root>
    </html.div>
  )
}
