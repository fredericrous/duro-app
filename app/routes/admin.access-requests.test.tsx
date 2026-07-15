import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))
vi.mock("~/lib/admin-guard.server", () => ({
  requireAdmin: vi
    .fn()
    .mockResolvedValue({ sub: "admin", user: "admin", email: "admin@test", groups: ["lldap_admin"] }),
  requireAdminAction: vi
    .fn()
    .mockResolvedValue({ sub: "admin", user: "admin", email: "admin@test", groups: ["lldap_admin"] }),
}))

import { runEffect } from "~/lib/runtime.server"
import { requireAdmin } from "~/lib/admin-guard.server"
import { loader } from "./admin.access-requests"
import { callLoader, expectData } from "~/test/route-utils"

const mockRunEffect = vi.mocked(runEffect)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("/admin/access-requests loader", () => {
  it("returns the enriched list from AccessRequestRepo", async () => {
    const requests = [{ id: "r1", status: "pending", applicationName: "App" }]
    mockRunEffect.mockResolvedValue(requests as never)

    const result = await callLoader(loader)
    const data = expectData<{ requests: unknown[] }>(result)
    expect(data.requests).toEqual(requests)
  })

  it("propagates an empty list", async () => {
    mockRunEffect.mockResolvedValue([] as never)
    const result = await callLoader(loader)
    const data = expectData<{ requests: unknown[] }>(result)
    expect(data.requests).toEqual([])
  })

  it("denies a non-admin caller (403) when the guard rejects", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new Response("Forbidden", { status: 403 }))
    const result = await callLoader(loader)
    expect(result.kind).toBe("response")
    if (result.kind === "response") expect(result.response.status).toBe(403)
  })
})

// ===========================================================================
// Component-render tests
// ===========================================================================

import { screen, waitFor } from "@testing-library/react"
import type { AccessRequestEnriched } from "~/lib/governance/AccessRequestRepo.server"
import AdminAccessRequestsPage from "./admin.access-requests"
import { renderRoute } from "~/test/render-route"

const reqRow = (overrides: Partial<AccessRequestEnriched>): AccessRequestEnriched =>
  ({
    id: overrides.id ?? "r1",
    requesterId: "p-alice",
    applicationId: "app-1",
    roleId: "role-1",
    entitlementId: null,
    resourceId: null,
    justification: null,
    requestedDurationHours: null,
    status: overrides.status ?? "pending",
    resolvedAt: null,
    grantId: null,
    createdAt: "2026-01-01T00:00:00Z",
    expiresAt: null,
    applicationName: overrides.applicationName ?? "App",
    applicationSlug: "app",
    roleName: overrides.roleName ?? "Editor",
    entitlementName: null,
    requesterName: overrides.requesterName ?? "Alice",
    ...overrides,
  }) as AccessRequestEnriched

const renderPage = (requests: AccessRequestEnriched[]) =>
  renderRoute({
    parentLoaderId: "routes/dashboard",
    parentLoader: () => ({ user: "admin", isAdmin: true }),
    route: {
      path: "/admin/access-requests",
      Component: AdminAccessRequestsPage as never,
      loader: () => ({ requests }),
    },
  })

describe("AdminAccessRequestsPage component", () => {
  it("renders the empty state when no requests exist", async () => {
    renderPage([])
    await waitFor(() => {
      expect(screen.getByText(/no.*access.*request|haven't|empty/i)).toBeInTheDocument()
    })
  })

  it("renders the table with one row per request and shows the count in the title", async () => {
    renderPage([
      reqRow({ id: "r1", applicationName: "Jellyfin", requesterName: "Alice" }),
      reqRow({ id: "r2", applicationName: "Vault", requesterName: "Bob" }),
      reqRow({ id: "r3", applicationName: "Gitea", requesterName: "Carol" }),
    ])

    await waitFor(() => {
      expect(screen.getByText("Jellyfin")).toBeInTheDocument()
    })
    expect(screen.getByText("Vault")).toBeInTheDocument()
    expect(screen.getByText("Gitea")).toBeInTheDocument()
    // The card title includes the count in parens.
    expect(screen.getByText(/\(3\)/)).toBeInTheDocument()
  })
})
