import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/admin-guard.server", () => ({
  requireAdmin: vi.fn(),
}))
vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))

import { requireAdmin } from "~/lib/admin-guard.server"
import { runEffect } from "~/lib/runtime.server"
import { loader } from "./admin.dashboard"
import { callLoader, expectData } from "~/test/route-utils"

const mockRequireAdmin = vi.mocked(requireAdmin)
const mockRunEffect = vi.mocked(runEffect)

type DashData = {
  setup: { hasApp: boolean; hasGrant: boolean; hasInvite: boolean }
  hygiene: { appsWithoutOwner: number; enabledAppsWithoutRole: number; staleInvitations: number }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("/admin dashboard loader", () => {
  it("returns setup milestones + hygiene findings for an admin", async () => {
    mockRequireAdmin.mockResolvedValue(undefined as never)
    mockRunEffect
      .mockResolvedValueOnce({ hasApp: true, hasGrant: false, hasInvite: false } as never)
      .mockResolvedValueOnce({ appsWithoutOwner: 2, enabledAppsWithoutRole: 0, staleInvitations: 1 } as never)

    const result = await callLoader(loader)
    const data = expectData<DashData>(result)
    expect(data.setup).toEqual({ hasApp: true, hasGrant: false, hasInvite: false })
    expect(data.hygiene.appsWithoutOwner).toBe(2)
    expect(data.hygiene.staleInvitations).toBe(1)
    expect(mockRequireAdmin).toHaveBeenCalledOnce()
  })

  it("falls back to safe defaults when a query fails", async () => {
    mockRequireAdmin.mockResolvedValue(undefined as never)
    mockRunEffect.mockRejectedValueOnce(new Error("db down")).mockRejectedValueOnce(new Error("db down"))

    const result = await callLoader(loader)
    const data = expectData<DashData>(result)
    // Setup defaults to "all done" (don't nag on a transient error); hygiene to zero.
    expect(data.setup).toEqual({ hasApp: true, hasGrant: true, hasInvite: true })
    expect(data.hygiene).toEqual({ appsWithoutOwner: 0, enabledAppsWithoutRole: 0, staleInvitations: 0 })
  })
})

// =============================================================================
// Component-render tests — the admin Overview page
// =============================================================================

import { fireEvent, screen } from "@testing-library/react"
import AdminDashboard from "./admin.dashboard"
import { renderRoute } from "~/test/render-route"
import { t } from "~/test/test-utils"

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
    ],
  })

describe("AdminDashboard component", () => {
  it("shows the first-run checklist, awaiting queue, and hygiene gaps", async () => {
    renderDashboard(
      {
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
    expect(screen.getByRole("link", { name: t("admin.dashboard.awaiting.review") })).toBeInTheDocument()
    // Governance-health gap surfaced.
    expect(
      screen.getByText(t("admin.hygiene.findings.apps_without_owner", undefined, { count: 2 })),
    ).toBeInTheDocument()

    // Exercise the fix-jump callbacks.
    fireEvent.click(screen.getByRole("button", { name: t("admin.firstRun.fix.firstApp") }))
    fireEvent.click(screen.getByRole("button", { name: t("admin.hygiene.fix.apps_without_owner") }))
  })

  it("stays quiet when setup is complete and nothing awaits review", async () => {
    renderDashboard({
      setup: { hasApp: true, hasGrant: true, hasInvite: true },
      hygiene: { appsWithoutOwner: 0, enabledAppsWithoutRole: 0, staleInvitations: 0 },
    })

    await screen.findByText(t("admin.dashboard.title"))
    expect(screen.queryByText(t("admin.firstRun.title"))).not.toBeInTheDocument()
    expect(screen.getByText(t("admin.dashboard.awaiting.allClear"))).toBeInTheDocument()
    expect(screen.getByText(t("admin.hygiene.allClear"))).toBeInTheDocument()
  })
})
