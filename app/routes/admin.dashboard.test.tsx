import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/admin-guard.server", () => ({
  requireAdmin: vi.fn(),
}))
vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))
// The stats module only exports Effect programs (evaluated via the mocked
// runEffect), but importing it pulls the whole server graph — stub it.
vi.mock("~/lib/governance/dashboard-stats.server", () => ({
  loadGlanceStats: "loadGlanceStats",
  loadExpiringSoon: vi.fn(() => "loadExpiringSoon"),
  loadRecentActivity: vi.fn(() => "loadRecentActivity"),
  loadHygieneExtras: "loadHygieneExtras",
}))

import { requireAdmin } from "~/lib/admin-guard.server"
import { runEffect } from "~/lib/runtime.server"
import { loader } from "./admin.dashboard"
import { callLoader, expectData } from "~/test/route-utils"

const mockRequireAdmin = vi.mocked(requireAdmin)
const mockRunEffect = vi.mocked(runEffect)

type GlanceData = {
  people: number
  serviceAccounts: number
  applicationsEnabled: number
  applicationsTotal: number
  activeGrants: number
  activeApiKeys: number
}
type ExpiringData = { kind: "grant" | "certificate" | "apiKey" | "invitation"; label: string; expiresAt: string }
type ActivityData = {
  id: string
  eventType: string
  actorName: string | null
  targetName: string | null
  applicationName: string | null
  createdAt: string | Date
}

type DashData = {
  setup: { hasApp: boolean; hasGrant: boolean; hasInvite: boolean }
  hygiene: { appsWithoutOwner: number; enabledAppsWithoutRole: number; staleInvitations: number }
  glance: GlanceData
  expiring: ExpiringData[]
  recentActivity: ActivityData[]
  hygieneExtras: { failedProvisioningJobs: number; connectorsWithErrors: number }
}

const GLANCE: GlanceData = {
  people: 3,
  serviceAccounts: 1,
  applicationsEnabled: 12,
  applicationsTotal: 30,
  activeGrants: 7,
  activeApiKeys: 2,
}

/** Queue mocked runEffect results in loader call order:
 * setup, hygiene, then the Promise.all batch (glance, expiring, activity, extras). */
function queueLoaderResults(
  overrides: Partial<Record<"setup" | "hygiene" | "glance" | "expiring" | "activity" | "extras", unknown>> = {},
) {
  mockRunEffect
    .mockResolvedValueOnce((overrides.setup ?? { hasApp: true, hasGrant: true, hasInvite: true }) as never)
    .mockResolvedValueOnce(
      (overrides.hygiene ?? { appsWithoutOwner: 0, enabledAppsWithoutRole: 0, staleInvitations: 0 }) as never,
    )
    .mockResolvedValueOnce((overrides.glance ?? GLANCE) as never)
    .mockResolvedValueOnce((overrides.expiring ?? []) as never)
    .mockResolvedValueOnce((overrides.activity ?? []) as never)
    .mockResolvedValueOnce((overrides.extras ?? { failedProvisioningJobs: 0, connectorsWithErrors: 0 }) as never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("/admin dashboard loader", () => {
  it("returns setup, hygiene, glance stats, expiring items and activity", async () => {
    mockRequireAdmin.mockResolvedValue(undefined as never)
    queueLoaderResults({
      setup: { hasApp: true, hasGrant: false, hasInvite: false },
      hygiene: { appsWithoutOwner: 2, enabledAppsWithoutRole: 0, staleInvitations: 1 },
      expiring: [{ kind: "grant", label: "Viewer → Bob", expiresAt: new Date().toISOString() }],
      activity: [
        {
          id: "e1",
          eventType: "auth.login",
          actorName: "Bob",
          targetName: null,
          applicationName: null,
          createdAt: new Date("2026-07-01T10:00:00Z"),
          metadata: {},
        },
      ],
      extras: { failedProvisioningJobs: 1, connectorsWithErrors: 0 },
    })

    const result = await callLoader(loader)
    const data = expectData<DashData>(result)
    expect(data.setup).toEqual({ hasApp: true, hasGrant: false, hasInvite: false })
    expect(data.hygiene.appsWithoutOwner).toBe(2)
    expect(data.glance).toEqual(GLANCE)
    expect(data.expiring).toHaveLength(1)
    // Activity rows are trimmed to display fields, dates serialized.
    expect(data.recentActivity).toEqual([
      {
        id: "e1",
        eventType: "auth.login",
        actorName: "Bob",
        targetName: null,
        applicationName: null,
        createdAt: "2026-07-01T10:00:00.000Z",
      },
    ])
    expect(data.hygieneExtras.failedProvisioningJobs).toBe(1)
    expect(mockRequireAdmin).toHaveBeenCalledOnce()
  })

  it("falls back to safe defaults when queries fail", async () => {
    mockRequireAdmin.mockResolvedValue(undefined as never)
    mockRunEffect.mockRejectedValue(new Error("db down"))

    const result = await callLoader(loader)
    const data = expectData<DashData>(result)
    // Setup defaults to "all done" (don't nag on a transient error); the rest to empty.
    expect(data.setup).toEqual({ hasApp: true, hasGrant: true, hasInvite: true })
    expect(data.hygiene).toEqual({ appsWithoutOwner: 0, enabledAppsWithoutRole: 0, staleInvitations: 0 })
    expect(data.glance.people).toBe(0)
    expect(data.expiring).toEqual([])
    expect(data.recentActivity).toEqual([])
    expect(data.hygieneExtras).toEqual({ failedProvisioningJobs: 0, connectorsWithErrors: 0 })
  })
})

// =============================================================================
// Component-render tests — the admin Overview page
// =============================================================================

import { fireEvent, screen } from "@testing-library/react"
import AdminDashboard from "./admin.dashboard"
import { renderRoute } from "~/test/render-route"
import { t } from "~/test/test-utils"

const BASE: DashData = {
  setup: { hasApp: true, hasGrant: true, hasInvite: true },
  hygiene: { appsWithoutOwner: 0, enabledAppsWithoutRole: 0, staleInvitations: 0 },
  glance: GLANCE,
  expiring: [],
  recentActivity: [],
  hygieneExtras: { failedProvisioningJobs: 0, connectorsWithErrors: 0 },
}

const renderDashboard = (loaderData: DashData, pendingCounts = { accessRequests: 0, accessInvitations: 0 }) =>
  renderRoute({
    parentLoaderId: "routes/admin",
    parentLoader: () => ({ pendingCounts }),
    route: {
      path: "/",
      Component: AdminDashboard as never,
      loader: () => loaderData,
    },
    // Fix-jump targets so onFix navigation resolves cleanly in the stub.
    children: [
      { path: "/admin/applications", loader: () => ({}) },
      { path: "/admin/grants/new", loader: () => ({}) },
      { path: "/admin/invitations", loader: () => ({}) },
      { path: "/admin/access-requests", loader: () => ({}) },
      { path: "/admin/plugins", loader: () => ({}) },
      { path: "/admin/grants", loader: () => ({}) },
      { path: "/admin/audit", loader: () => ({}) },
    ],
  })

describe("AdminDashboard component", () => {
  it("shows the first-run checklist, awaiting queue, and hygiene gaps", async () => {
    renderDashboard(
      {
        ...BASE,
        setup: { hasApp: false, hasGrant: false, hasInvite: false },
        hygiene: { appsWithoutOwner: 2, enabledAppsWithoutRole: 0, staleInvitations: 0 },
      },
      { accessRequests: 2, accessInvitations: 0 },
    )

    await screen.findByText(t("admin.dashboard.title"))
    // First-run checklist visible while setup is incomplete.
    expect(screen.getByText(t("admin.firstRun.title"))).toBeInTheDocument()
    // Awaiting-review summary lists the pending access requests with a Review jump.
    expect(screen.getByText(t("admin.dashboard.awaiting.accessRequests", undefined, { count: 2 }))).toBeInTheDocument()
    // Governance-health gap surfaced.
    expect(
      screen.getByText(t("admin.hygiene.findings.apps_without_owner", undefined, { count: 2 })),
    ).toBeInTheDocument()

    // Exercise the fix-jump callbacks.
    fireEvent.click(screen.getByRole("button", { name: t("admin.firstRun.fix.firstApp") }))
    fireEvent.click(screen.getByRole("button", { name: t("admin.hygiene.fix.apps_without_owner") }))
  })

  it("stays quiet when setup is complete and nothing awaits review", async () => {
    renderDashboard(BASE)

    await screen.findByText(t("admin.dashboard.title"))
    expect(screen.queryByText(t("admin.firstRun.title"))).not.toBeInTheDocument()
    expect(screen.getByText(t("admin.dashboard.awaiting.allClear"))).toBeInTheDocument()
    expect(screen.getByText(t("admin.hygiene.allClear"))).toBeInTheDocument()
    // Estate panels render with quiet empty states.
    expect(screen.getByText(t("admin.dashboard.expiring.empty"))).toBeInTheDocument()
    expect(screen.getByText(t("admin.dashboard.activity.empty"))).toBeInTheDocument()
  })

  it("renders glance tiles, expiring items and the activity feed", async () => {
    renderDashboard({
      ...BASE,
      expiring: [
        { kind: "certificate", label: "user-two", expiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString() },
        { kind: "grant", label: "Viewer → Bob", expiresAt: new Date(Date.now() + 10 * 86_400_000).toISOString() },
      ],
      recentActivity: [
        {
          id: "e1",
          eventType: "grant.created",
          actorName: "Alice",
          targetName: "Viewer → Bob",
          applicationName: null,
          createdAt: "2026-07-26T09:00:00.000Z",
        },
      ],
      hygieneExtras: { failedProvisioningJobs: 2, connectorsWithErrors: 0 },
    })

    await screen.findByText(t("admin.dashboard.title"))
    // Glance tiles.
    expect(screen.getByText(t("admin.dashboard.glance.people"))).toBeInTheDocument()
    expect(screen.getByText(t("admin.dashboard.glance.activeGrants"))).toBeInTheDocument()
    // Expiring rows with kind badges, soonest first.
    expect(screen.getByText(t("admin.dashboard.expiring.title"))).toBeInTheDocument()
    expect(screen.getByText("user-two")).toBeInTheDocument()
    expect(screen.getByText("Viewer → Bob")).toBeInTheDocument()
    // New hygiene finding wired to the plugins fix-jump.
    expect(
      screen.getByText(t("admin.hygiene.findings.failed_provisioning", undefined, { count: 2 })),
    ).toBeInTheDocument()
    // Activity feed row + view-all link.
    expect(screen.getByText(t("admin.dashboard.activity.title"))).toBeInTheDocument()
    expect(screen.getByRole("link", { name: t("admin.dashboard.activity.viewAll") })).toBeInTheDocument()
  })
})
