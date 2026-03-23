import { useState, useRef, useCallback, type ReactNode } from "react"
import { Outlet, useLocation, useNavigate, useRouteLoaderData, useOutletContext } from "react-router"
import { css, html } from "react-strict-dom"
import { useTranslation } from "react-i18next"
import type { Route } from "./+types/admin"
import { getAuth } from "~/lib/auth.server"
import { config } from "~/lib/config.server"
import { DetailPanel, PageShell, Tabs } from "@duro-app/ui"
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
  content: {
    paddingTop: spacing.md,
  },
  contentVertical: {
    paddingTop: 0,
    paddingLeft: spacing.md,
    flex: 1,
    minWidth: 0,
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
}

export function useAdminSidePanel() {
  return useOutletContext<AdminSidePanelContext>()
}

export function meta() {
  return [{ title: "Admin - Duro" }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await getAuth(request)
  if (!auth.groups.includes(config.adminGroupName)) {
    throw new Response("Forbidden", { status: 403 })
  }
  return {}
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

  const handlePanelOpenChange = useCallback((open: boolean) => {
    setSidePanelOpen(open)
    if (!open && onCloseRef.current) {
      onCloseRef.current()
    }
  }, [])

  const activeTab = location.pathname === "/admin/users" ? "users" : "invites"

  const outletContext: AdminSidePanelContext = {
    open: sidePanelOpen,
    onOpenChange: setSidePanelOpen,
    content: sidePanelContent,
    setContent: setSidePanelContent,
    onCloseRef,
  }

  return (
    <html.div style={styles.outerFlex}>
      <html.div style={styles.pageWrap}>
        <PageShell
          maxWidth="lg"
          header={<Header user={dashboardData?.user ?? ""} isAdmin={dashboardData?.isAdmin ?? false} />}
        >
          <Tabs.Root
            value={activeTab}
            onValueChange={(value) => {
              navigate(value === "users" ? "/admin/users" : "/admin")
            }}
            orientation={isWide ? "vertical" : "horizontal"}
          >
            <Tabs.List>
              <Tabs.Tab value="invites">{t("admin.tabs.invites", "Invites")}</Tabs.Tab>
              <Tabs.Tab value="users">{t("admin.tabs.users", "Users")}</Tabs.Tab>
            </Tabs.List>
            <html.div style={[styles.content, isWide && styles.contentVertical]}>
              <Outlet context={outletContext} />
            </html.div>
          </Tabs.Root>
        </PageShell>
      </html.div>

      {/* DetailPanel rendered at layout level — pushes entire page left */}
      <DetailPanel.Root open={sidePanelOpen} onOpenChange={handlePanelOpenChange}>
        <DetailPanel.Content size="md" label="Detail panel">
          {sidePanelContent}
        </DetailPanel.Content>
      </DetailPanel.Root>
    </html.div>
  )
}
