import { useEffect, useState, useRef, useCallback, type ReactNode } from "react"
import { Effect } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { Outlet, useLocation, useNavigate, useRouteLoaderData, useOutletContext, useRevalidator } from "react-router"
import { css, html } from "react-strict-dom"
import { useTranslation } from "react-i18next"
import type { Route } from "./+types/admin"
import { getAuth } from "~/lib/auth.server"
import { checkAuthDecision } from "~/lib/auth-decision.server"
import { runEffect } from "~/lib/runtime.server"
import { Badge, Button, DetailPanel, Drawer, Icon, Inline, PageShell, SideNav, Stack } from "@duro-app/ui"
import { Header } from "~/components/Header/Header"
import { SetupCompleteness, type SetupCriterion } from "~/components/AppOverview/SetupCompleteness"
import { GovernanceHygiene, type HygieneFinding } from "~/components/GovernanceHygiene/GovernanceHygiene"
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
    // Safety net: nothing in the admin content may push the page wider than
    // the viewport (which would shove the header's account menu off-screen on
    // mobile). `clip` — not `hidden` — so it doesn't create a scroll container
    // or break sticky positioning / table scroll-ports nested inside.
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
    }),
  ).catch(() => ({ accessRequests: 0, accessInvitations: 0 }))

  // First-run milestones: does the instance have at least one application, one
  // grant, and one invitation ever? Drives the setup checklist on the admin
  // landing. `EXISTS` keeps it to a cheap boolean per table.
  const setup = await runEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [apps, grants, invites] = yield* Effect.all([
        sql`SELECT EXISTS(SELECT 1 FROM applications) AS x`,
        sql`SELECT EXISTS(SELECT 1 FROM grants) AS x`,
        sql`SELECT EXISTS(SELECT 1 FROM access_invitations) AS x`,
      ])
      const has = (r: readonly unknown[]) => Boolean((r[0] as { x?: boolean } | undefined)?.x)
      return { hasApp: has(apps), hasGrant: has(grants), hasInvite: has(invites) }
    }),
  ).catch(() => ({ hasApp: true, hasGrant: true, hasInvite: true }))

  // Governance-health gaps: real misconfigurations an admin should clear —
  // apps with no owner, enabled apps with no role (so nothing can be granted),
  // and pending invitations that have already expired.
  const hygiene = await runEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [noOwner, noRole, staleInv] = yield* Effect.all([
        sql`SELECT count(*)::int AS n FROM applications WHERE owner_id IS NULL`,
        sql`SELECT count(*)::int AS n FROM applications a
            WHERE a.enabled = true AND NOT EXISTS (SELECT 1 FROM roles r WHERE r.application_id = a.id)`,
        sql`SELECT count(*)::int AS n FROM access_invitations
            WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < now()`,
      ])
      const n = (r: readonly unknown[]) => ((r[0] as { n?: number } | undefined)?.n ?? 0) as number
      return {
        appsWithoutOwner: n(noOwner),
        enabledAppsWithoutRole: n(noRole),
        staleInvitations: n(staleInv),
      }
    }),
  ).catch(() => ({ appsWithoutOwner: 0, enabledAppsWithoutRole: 0, staleInvitations: 0 }))

  return { pendingCounts, setup, hygiene }
}

function deriveActiveValue(pathname: string): string {
  if (pathname === "/admin" || pathname === "/admin/") return "invites"
  const segment = pathname.replace("/admin/", "").split("/")[0]
  // Users + Principals merged into Identities; their old paths keep the
  // Identities nav item highlighted (principals/:id detail included).
  if (segment === "users" || segment === "principals") return "identities"
  return segment || "invites"
}

const navMap: Record<string, string> = {
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
  invites: "/admin",
}

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const isWide = useMediaQuery("(min-width: 768px)", true)
  const dashboardData = useRouteLoaderData("routes/dashboard") as {
    user: string
    isAdmin: boolean
  }
  const counts = loaderData?.pendingCounts ?? { accessRequests: 0, accessInvitations: 0 }
  const revalidator = useRevalidator()

  // First-run onboarding checklist — shown on the admin landing until the
  // instance has its first application, grant, and invitation. Reuses the
  // per-app SetupCompleteness machinery via i18nPrefix.
  const setup = loaderData?.setup ?? { hasApp: true, hasGrant: true, hasInvite: true }
  const setupComplete = setup.hasApp && setup.hasGrant && setup.hasInvite
  const isAdminIndex = location.pathname === "/admin" || location.pathname === "/admin/"
  const firstRunCriteria: SetupCriterion[] = [
    { id: "firstApp", done: setup.hasApp, onFix: () => navigate("/admin/applications") },
    { id: "firstGrant", done: setup.hasGrant, onFix: () => navigate("/admin/grants/new") },
    { id: "firstInvite", done: setup.hasInvite, onFix: () => navigate("/admin/invitations") },
  ]
  const firstRunPanel =
    isAdminIndex && !setupComplete ? (
      <SetupCompleteness criteria={firstRunCriteria} i18nPrefix="admin.firstRun" />
    ) : null

  // Governance-health panel — actionable gaps on the admin landing. Shown once
  // the instance is operational (or whenever there's something to fix), so it
  // doesn't compete with the first-run checklist during initial setup.
  const hygiene = loaderData?.hygiene ?? { appsWithoutOwner: 0, enabledAppsWithoutRole: 0, staleInvitations: 0 }
  const hygieneFindings: HygieneFinding[] = [
    { id: "apps_without_owner", count: hygiene.appsWithoutOwner, onFix: () => navigate("/admin/applications") },
    {
      id: "enabled_apps_without_role",
      count: hygiene.enabledAppsWithoutRole,
      onFix: () => navigate("/admin/applications"),
    },
    { id: "stale_invitations", count: hygiene.staleInvitations, onFix: () => navigate("/admin/invitations") },
  ]
  const hasHygieneFindings = hygieneFindings.some((f) => f.count > 0)
  const hygienePanel =
    isAdminIndex && (setupComplete || hasHygieneFindings) ? <GovernanceHygiene findings={hygieneFindings} /> : null

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
      {/* Flat menu: static (non-collapsible) Section headers + per-item icons,
          grouped by the admin's job rather than the data model. Item values
          (and thus navMap/URLs) are unchanged. */}
      <SideNav.Section label={t("admin.nav.accessManagement", "Access management")}>
        <SideNav.Item value="identities" icon={<Icon name="users" size={18} />}>
          {t("admin.nav.identities", "Identities")}
        </SideNav.Item>
        <SideNav.Item value="grants" icon={<Icon name="key" size={18} />}>
          {t("admin.nav.grants", "Grants")}
        </SideNav.Item>
        <SideNav.Item value="applications" icon={<Icon name="layers" size={18} />}>
          {t("admin.nav.applications", "Applications")}
        </SideNav.Item>
      </SideNav.Section>
      <SideNav.Section label={t("admin.nav.requestsInvites", "Requests & invites")}>
        <SideNav.Item value="access-requests" icon={<Icon name="clock" size={18} />}>
          <NavLabel label={t("admin.nav.accessRequests", "Access Requests")} count={counts.accessRequests} />
        </SideNav.Item>
        <SideNav.Item value="invitations" icon={<Icon name="mail" size={18} />}>
          <NavLabel label={t("admin.nav.invitations", "Access Invitations")} count={counts.accessInvitations} />
        </SideNav.Item>
        <SideNav.Item value="invites" icon={<Icon name="user-plus" size={18} />}>
          {t("admin.nav.invites", "User Invites")}
        </SideNav.Item>
      </SideNav.Section>
      <SideNav.Section label={t("admin.nav.auditRecovery", "Audit & recovery")}>
        <SideNav.Item value="audit" icon={<Icon name="file-text" size={18} />}>
          {t("admin.nav.auditLog", "Audit Log")}
        </SideNav.Item>
        <SideNav.Item value="recovery" icon={<Icon name="shield" size={18} />}>
          {t("admin.nav.recovery", "Device Recovery")}
        </SideNav.Item>
      </SideNav.Section>
      {/* Group Mappings intentionally lives on /admin/identities (a button in
          its header), not in the menu — it's identity/group configuration. */}
      <SideNav.Section label={t("admin.nav.advanced", "Advanced")}>
        <SideNav.Item value="authz-playground" icon={<Icon name="shield-check" size={18} />}>
          {t("admin.nav.authzPlayground", "Authz Playground")}
        </SideNav.Item>
        <SideNav.Item value="plugins" icon={<Icon name="plug" size={18} />}>
          {t("admin.nav.plugins", "Plugins")}
        </SideNav.Item>
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
                <Stack gap="lg">
                  {firstRunPanel}
                  {hygienePanel}
                  <Outlet context={outletContext} />
                </Stack>
              </html.div>
            </html.div>
          ) : (
            <>
              <html.div style={styles.mobileHeader}>
                <Button variant="secondary" size="small" onClick={() => setNavDrawerOpen(true)}>
                  {t("admin.nav.menu", "Menu")}
                </Button>
              </html.div>
              <Stack gap="lg">
                {firstRunPanel}
                {hygienePanel}
                <Outlet context={outletContext} />
              </Stack>
            </>
          )}
        </PageShell>
      </html.div>

      {/* Navigation drawer for narrow screens */}
      <Drawer.Root open={navDrawerOpen} onOpenChange={setNavDrawerOpen} anchor="left">
        <Drawer.Portal size="sm">
          <Drawer.Header>
            <Drawer.Title>{t("admin.nav.title", "Navigation")}</Drawer.Title>
            <Drawer.Close aria-label={t("admin.detailPanel.close")} />
          </Drawer.Header>
          <Drawer.Body>{navContent}</Drawer.Body>
        </Drawer.Portal>
      </Drawer.Root>

      {/* DetailPanel rendered at layout level — pushes entire page left */}
      {isWide && (
        <DetailPanel.Root open={sidePanelOpen} onOpenChange={handlePanelOpenChange}>
          <DetailPanel.Content size="md" label={t("admin.detailPanel.label")}>
            {sidePanelContent}
          </DetailPanel.Content>
        </DetailPanel.Root>
      )}
    </html.div>
  )
}
