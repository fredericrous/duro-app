import { useEffect, useState, useRef, useCallback, type ReactNode } from "react"
import { Effect } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { Outlet, useLocation, useNavigate, useRouteLoaderData, useOutletContext, useRevalidator } from "react-router"
import { html } from "react-strict-dom"
import { useTranslation } from "react-i18next"
import type { Route } from "./+types/admin"
import { getAuth } from "~/lib/auth.server"
import { checkAuthDecision } from "~/lib/auth-decision.server"
import { runEffect } from "~/lib/runtime.server"
import { Badge, DetailPanel, Icon, Inline, SideNav, Stack } from "@duro-app/ui"
import { Header } from "~/components/Header/Header"
import { AppShell, type AppShellNavProps } from "~/components/AppShell/AppShell"
import { useMediaQuery } from "~/hooks/useMediaQuery"
import { breakpoints } from "@duro-app/tokens/tokens/breakpoints.css"

// Side-nav label with optional pending count chip. Co-located here because
// it's only used for admin navigation and depends on the loader's count shape.
function NavLabel({ label, count }: { label: string; count: number }) {
  if (count <= 0) return <>{label}</>
  return (
    <Inline gap="sm" align="center" justify="between">
      <html.span>{label}</html.span>
      <Badge variant="warning">{count}</Badge>
    </Inline>
  )
}

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

  // Pending counts surface as side-nav badges so an admin can see at a glance
  // what's waiting for them. Use raw SQL because the repos don't expose count
  // helpers and a row-decode round-trip would be wasteful for a single number.
  const pendingCounts = await runEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [accessRequests, accessInvitations] = yield* Effect.all([
        sql`SELECT count(*)::int AS n FROM access_requests WHERE status = 'pending'`,
        sql`SELECT count(*)::int AS n FROM access_invitations WHERE status = 'pending'`,
      ])
      return {
        accessRequests: ((accessRequests[0] as { n?: number } | undefined)?.n ?? 0) as number,
        accessInvitations: ((accessInvitations[0] as { n?: number } | undefined)?.n ?? 0) as number,
      }
    }).pipe(Effect.orDie), // rejection handled by .catch below
  ).catch(() => ({ accessRequests: 0, accessInvitations: 0 }))

  // First-run + governance-health data lives on the admin index (dashboard)
  // route now — the layout only owns the nav pending-count badges.
  return { pendingCounts }
}

function deriveActiveValue(pathname: string): string {
  if (pathname === "/admin" || pathname === "/admin/") return "dashboard"
  const segment = pathname.replace("/admin/", "").split("/")[0]
  // Users + Principals merged into Identities; their old paths keep the
  // Identities nav item highlighted (principals/:id detail included).
  if (segment === "users" || segment === "principals") return "identities"
  return segment || "dashboard"
}

const navMap: Record<string, string> = {
  dashboard: "/admin",
  identities: "/admin/identities",
  applications: "/admin/applications",
  grants: "/admin/grants",
  "access-requests": "/admin/access-requests",
  invitations: "/admin/invitations",
  "group-mappings": "/admin/group-mappings",
  "authz-playground": "/admin/authz-playground",
  audit: "/admin/audit",
  recovery: "/admin/recovery",
  plugins: "/admin/plugins",
  invites: "/admin/invites",
}

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const isWide = useMediaQuery(`(min-width: ${breakpoints.md})`, true)
  const dashboardData = useRouteLoaderData("routes/dashboard") as {
    user: string
    isAdmin: boolean
  }
  const counts = loaderData?.pendingCounts ?? { accessRequests: 0, accessInvitations: 0 }
  const revalidator = useRevalidator()

  // Refresh side-nav counts every 45s while the tab is foregrounded so an
  // admin who leaves the page open doesn't miss new pending work. Pause when
  // the tab is hidden — background tabs shouldn't poll. The interval is
  // re-armed on visibilitychange.
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null

    const start = () => {
      if (intervalId !== null) return
      intervalId = setInterval(() => revalidator.revalidate(), 45_000)
    }
    const stop = () => {
      if (intervalId !== null) {
        clearInterval(intervalId)
        intervalId = null
      }
    }

    if (typeof document !== "undefined" && document.visibilityState === "visible") start()

    const onVisibility = () => {
      if (typeof document === "undefined") return
      if (document.visibilityState === "visible") {
        // Catch up immediately on focus before resuming the cadence.
        revalidator.revalidate()
        start()
      } else {
        stop()
      }
    }

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility)
    }
    return () => {
      stop()
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility)
      }
    }
  }, [revalidator])

  const [sidePanelOpen, setSidePanelOpen] = useState(false)
  const [sidePanelContent, setSidePanelContent] = useState<ReactNode | null>(null)
  const onCloseRef = useRef<(() => void) | null>(null)

  const handlePanelOpenChange = useCallback((open: boolean) => {
    setSidePanelOpen(open)
    if (!open && onCloseRef.current) {
      onCloseRef.current()
    }
  }, [])

  const activeValue = deriveActiveValue(location.pathname)

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

  const nav = ({ onSelect }: AppShellNavProps) => (
    <SideNav.Root
      value={activeValue}
      onValueChange={(value) => {
        const path = navMap[value]
        if (path) navigate(path)
        onSelect()
      }}
    >
      {/* Flat menu: static (non-collapsible) Section headers + per-item icons,
          grouped by the admin's job rather than the data model. Item values
          (and thus navMap/URLs) are unchanged. */}
      <SideNav.Section label={t("admin.nav.overview", "Overview")}>
        <SideNav.Item value="dashboard" icon={<Icon name="map" size="md" />}>
          {t("admin.nav.dashboard", "Dashboard")}
        </SideNav.Item>
      </SideNav.Section>
      <SideNav.Section label={t("admin.nav.accessManagement", "Access management")}>
        <SideNav.Item value="identities" icon={<Icon name="users" size="md" />}>
          {t("admin.nav.identities", "Identities")}
        </SideNav.Item>
        <SideNav.Item value="grants" icon={<Icon name="key" size="md" />}>
          {t("admin.nav.grants", "Grants")}
        </SideNav.Item>
        <SideNav.Item value="applications" icon={<Icon name="layers" size="md" />}>
          {t("admin.nav.applications", "Applications")}
        </SideNav.Item>
      </SideNav.Section>
      <SideNav.Section label={t("admin.nav.requestsInvites", "Requests & invites")}>
        <SideNav.Item value="access-requests" icon={<Icon name="clock" size="md" />}>
          <NavLabel label={t("admin.nav.accessRequests", "Access Requests")} count={counts.accessRequests} />
        </SideNav.Item>
        <SideNav.Item value="invitations" icon={<Icon name="mail" size="md" />}>
          <NavLabel label={t("admin.nav.invitations", "Access Invitations")} count={counts.accessInvitations} />
        </SideNav.Item>
        <SideNav.Item value="invites" icon={<Icon name="user-plus" size="md" />}>
          {t("admin.nav.invites", "User Invites")}
        </SideNav.Item>
      </SideNav.Section>
      <SideNav.Section label={t("admin.nav.auditRecovery", "Audit & recovery")}>
        <SideNav.Item value="audit" icon={<Icon name="file-text" size="md" />}>
          {t("admin.nav.auditLog", "Audit Log")}
        </SideNav.Item>
        <SideNav.Item value="recovery" icon={<Icon name="shield" size="md" />}>
          {t("admin.nav.recovery", "Device Recovery")}
        </SideNav.Item>
      </SideNav.Section>
      {/* Group Mappings intentionally lives on /admin/identities (a button in
          its header), not in the menu — it's identity/group configuration. */}
      <SideNav.Section label={t("admin.nav.advanced", "Advanced")}>
        <SideNav.Item value="authz-playground" icon={<Icon name="shield-check" size="md" />}>
          {t("admin.nav.authzPlayground", "Authz Playground")}
        </SideNav.Item>
        <SideNav.Item value="plugins" icon={<Icon name="plug" size="md" />}>
          {t("admin.nav.plugins", "Plugins")}
        </SideNav.Item>
      </SideNav.Section>
    </SideNav.Root>
  )

  return (
    <AppShell
      header={<Header user={dashboardData?.user ?? ""} isAdmin={dashboardData?.isAdmin ?? false} />}
      nav={nav}
      navTitle={t("admin.nav.title", "Navigation")}
      menuLabel={t("admin.nav.menu", "Menu")}
      closeLabel={t("admin.detailPanel.close")}
      aside={
        // DetailPanel at layout level — pushes the entire page left. Wide only:
        // on narrow screens showDetail navigates to the detail route instead.
        isWide && (
          <DetailPanel.Root open={sidePanelOpen} onOpenChange={handlePanelOpenChange}>
            <DetailPanel.Content size="md" label={t("admin.detailPanel.label")}>
              {sidePanelContent}
            </DetailPanel.Content>
          </DetailPanel.Root>
        )
      }
    >
      <Stack gap="lg">
        <Outlet context={outletContext} />
      </Stack>
    </AppShell>
  )
}
