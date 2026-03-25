import { useState, useRef, useCallback, type ReactNode } from "react"
import { Outlet, useLocation, useNavigate, useRouteLoaderData, useOutletContext } from "react-router"
import { css, html } from "react-strict-dom"
import { useTranslation } from "react-i18next"
import type { Route } from "./+types/admin"
import { getAuth } from "~/lib/auth.server"
import { checkAuthDecision } from "~/lib/auth-decision.server"
import { Button, DetailPanel, Drawer, PageShell, SideNav } from "@duro-app/ui"
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

// --- Side panel via Outlet context ---

export interface AdminSidePanelContext {
  open: boolean
  onOpenChange: (open: boolean) => void
  content: ReactNode | null
  setContent: (content: ReactNode | null) => void
  /** Register a callback that fires when panel is closed externally (ESC, close button) */
  onCloseRef: React.MutableRefObject<(() => void) | null>
  showDetail: (content: ReactNode, detailPath: string) => void
  isWide: boolean
}

export function useAdminSidePanel() {
  return useOutletContext<AdminSidePanelContext>()
}

export function meta() {
  return [{ title: "Admin - Duro" }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await getAuth(request)
  const decision = await checkAuthDecision({ auth, application: "duro", action: "admin" })
  if (!decision.allow) throw new Response("Forbidden", { status: 403 })
  return {}
}

function deriveActiveValue(pathname: string): string {
  if (pathname === "/admin" || pathname === "/admin/") return "invites"
  const segment = pathname.replace("/admin/", "").split("/")[0]
  return segment || "invites"
}

const navMap: Record<string, string> = {
  applications: "/admin/applications",
  principals: "/admin/principals",
  grants: "/admin/grants",
  "access-requests": "/admin/access-requests",
  invitations: "/admin/invitations",
  "authz-playground": "/admin/authz-playground",
  audit: "/admin/audit",
  invites: "/admin",
  users: "/admin/users",
}

export default function AdminLayout() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const isWide = useMediaQuery("(min-width: 768px)", true)
  const dashboardData = useRouteLoaderData("routes/dashboard") as {
    user: string
    isAdmin: boolean
  }

  const [sidePanelOpen, setSidePanelOpen] = useState(false)
  const [sidePanelContent, setSidePanelContent] = useState<ReactNode | null>(null)
  const onCloseRef = useRef<(() => void) | null>(null)
  const [navDrawerOpen, setNavDrawerOpen] = useState(false)

  const handlePanelOpenChange = useCallback((open: boolean) => {
    setSidePanelOpen(open)
    if (!open && onCloseRef.current) {
      onCloseRef.current()
    }
  }, [])

  const activeValue = deriveActiveValue(location.pathname)

  const handleValueChange = useCallback(
    (value: string) => {
      const path = navMap[value]
      if (path) navigate(path)
      setNavDrawerOpen(false)
    },
    [navigate],
  )

  const showDetail = useCallback(
    (content: ReactNode, detailPath: string) => {
      if (isWide) {
        setSidePanelContent(content)
        setSidePanelOpen(true)
      } else {
        navigate(detailPath)
      }
    },
    [isWide, navigate],
  )

  const outletContext: AdminSidePanelContext = {
    open: sidePanelOpen,
    onOpenChange: setSidePanelOpen,
    content: sidePanelContent,
    setContent: setSidePanelContent,
    onCloseRef,
    showDetail,
    isWide,
  }

  const navContent = (
    <SideNav.Root value={activeValue} onValueChange={handleValueChange}>
      <SideNav.Group label={t("admin.nav.accessManagement", "Access Management")} defaultExpanded>
        <SideNav.Item value="applications">{t("admin.nav.applications", "Applications")}</SideNav.Item>
        <SideNav.Item value="principals">{t("admin.nav.principals", "Principals")}</SideNav.Item>
        <SideNav.Item value="grants">{t("admin.nav.grants", "Grants")}</SideNav.Item>
      </SideNav.Group>
      <SideNav.Group label={t("admin.nav.workflows", "Workflows")}>
        <SideNav.Item value="access-requests">{t("admin.nav.accessRequests", "Access Requests")}</SideNav.Item>
        <SideNav.Item value="invitations">{t("admin.nav.invitations", "Invitations")}</SideNav.Item>
      </SideNav.Group>
      <SideNav.Group label={t("admin.nav.security", "Security")}>
        <SideNav.Item value="authz-playground">{t("admin.nav.authzPlayground", "Authz Playground")}</SideNav.Item>
        <SideNav.Item value="audit">{t("admin.nav.auditLog", "Audit Log")}</SideNav.Item>
      </SideNav.Group>
      <SideNav.Group label={t("admin.nav.system", "System")}>
        <SideNav.Item value="invites">{t("admin.nav.invites", "Invites")}</SideNav.Item>
        <SideNav.Item value="users">{t("admin.nav.users", "Users")}</SideNav.Item>
      </SideNav.Group>
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
                <Outlet context={outletContext} />
              </html.div>
            </html.div>
          ) : (
            <>
              <html.div style={styles.mobileHeader}>
                <Button variant="secondary" size="small" onClick={() => setNavDrawerOpen(true)}>
                  {t("admin.nav.menu", "Menu")}
                </Button>
              </html.div>
              <Outlet context={outletContext} />
            </>
          )}
        </PageShell>
      </html.div>

      {/* Navigation drawer for narrow screens */}
      <Drawer.Root open={navDrawerOpen} onOpenChange={setNavDrawerOpen} anchor="left">
        <Drawer.Portal size="sm">
          <Drawer.Header>
            <Drawer.Title>{t("admin.nav.title", "Navigation")}</Drawer.Title>
            <Drawer.Close />
          </Drawer.Header>
          <Drawer.Body>{navContent}</Drawer.Body>
        </Drawer.Portal>
      </Drawer.Root>

      {/* DetailPanel rendered at layout level — pushes entire page left */}
      {isWide && (
        <DetailPanel.Root open={sidePanelOpen} onOpenChange={handlePanelOpenChange}>
          <DetailPanel.Content size="md" label="Detail panel">
            {sidePanelContent}
          </DetailPanel.Content>
        </DetailPanel.Root>
      )}
    </html.div>
  )
}
