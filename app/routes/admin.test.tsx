import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/auth.server", () => ({
  getAuth: vi.fn(),
}))
vi.mock("~/lib/auth-decision.server", () => ({
  checkAuthDecision: vi.fn(),
}))
vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))

import { getAuth } from "~/lib/auth.server"
import { checkAuthDecision } from "~/lib/auth-decision.server"
import { runEffect } from "~/lib/runtime.server"
import { loader } from "./admin"
import { callLoader, expectData, expectResponse } from "~/test/route-utils"

const mockGetAuth = vi.mocked(getAuth)
const mockCheckDecision = vi.mocked(checkAuthDecision)
const mockRunEffect = vi.mocked(runEffect)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("/admin layout loader", () => {
  it("throws 403 when caller isn't an admin", async () => {
    mockGetAuth.mockResolvedValue({ user: "alice", sub: "alice-sub" } as never)
    mockCheckDecision.mockResolvedValue({ allow: false } as never)
    const result = await callLoader(loader)
    expect(expectResponse(result).status).toBe(403)
  })

  it("returns pendingCounts when admin", async () => {
    mockGetAuth.mockResolvedValue({ user: "alice", sub: "alice-sub" } as never)
    mockCheckDecision.mockResolvedValue({ allow: true } as never)
    mockRunEffect.mockResolvedValue({ accessRequests: 3, accessInvitations: 1 } as never)

    const result = await callLoader(loader)
    const data = expectData<{ pendingCounts: { accessRequests: number; accessInvitations: number } }>(result)
    expect(data.pendingCounts.accessRequests).toBe(3)
    expect(data.pendingCounts.accessInvitations).toBe(1)
  })
})

// =============================================================================
// Component-render tests — the AdminLayout chrome (side nav + outlet)
// =============================================================================

import { screen, waitFor } from "@testing-library/react"
import AdminLayout from "./admin"
import { renderRoute } from "~/test/render-route"
import { t } from "~/test/test-utils"

const renderLayout = (loaderData = { pendingCounts: { accessRequests: 0, accessInvitations: 0 } }) =>
  renderRoute({
    parentLoaderId: "routes/dashboard",
    parentLoader: () => ({ user: "admin", isAdmin: true }),
    route: {
      // Route at "/" of the parent stub. Use index pattern.
      path: "/",
      Component: AdminLayout as never,
      loader: () => loaderData,
    },
  })

describe("AdminLayout component", () => {
  it("renders every static section with its items visible", async () => {
    renderLayout()
    await waitFor(() => {
      // Sections are static (non-collapsible), so every item is visible with no
      // interaction — nothing folds.
      expect(screen.getByText(t("admin.nav.identities", "Identities"))).toBeInTheDocument()
    })
    // Applications lives in the Access management section.
    expect(screen.getByText(t("admin.nav.applications", "Applications"))).toBeInTheDocument()
    // Items across other sections are visible too (no folding). Plugins is in
    // the Advanced section (Group Mappings intentionally lives on /admin/
    // identities, not the menu).
    expect(screen.getByText(t("admin.nav.plugins", "Plugins"))).toBeInTheDocument()
    expect(screen.getByText(t("admin.nav.invites", "User Invites"))).toBeInTheDocument()
    // Group Mappings must NOT be in the menu anymore.
    expect(screen.queryByText(t("admin.nav.groupMappings", "Group Mappings"))).not.toBeInTheDocument()
  })

  it("marks the active item for the current route", async () => {
    // At the "/admin" index the derived active value is "dashboard" (Overview).
    // Query the button by role — SideNav.Item wraps its label in a span, so the
    // label text node isn't the element that carries aria-current.
    renderLayout({ pendingCounts: { accessRequests: 7, accessInvitations: 2 } })
    await waitFor(() => {
      expect(screen.getByRole("button", { name: t("admin.nav.dashboard", "Dashboard") })).toHaveAttribute(
        "aria-current",
        "page",
      )
    })
  })
})
