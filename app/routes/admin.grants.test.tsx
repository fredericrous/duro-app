import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))
vi.mock("~/lib/config.server", () => ({
  isOriginAllowed: vi.fn().mockReturnValue(true),
}))
vi.mock("~/lib/auth.server", () => ({
  getAuth: vi.fn(),
}))
vi.mock("~/lib/auth-decision.server", () => ({
  checkAuthDecision: vi.fn(),
}))
vi.mock("~/lib/workflows/grant-activation.server", () => ({
  deactivateGrant: vi.fn(),
}))

import { runEffect } from "~/lib/runtime.server"
import { isOriginAllowed } from "~/lib/config.server"
import { getAuth } from "~/lib/auth.server"
import { checkAuthDecision } from "~/lib/auth-decision.server"
import { action, loader } from "./admin.grants"
import { callAction, callLoader, expectData, expectResponse } from "~/test/route-utils"

const mockRunEffect = vi.mocked(runEffect)
const mockOrigin = vi.mocked(isOriginAllowed)
const mockGetAuth = vi.mocked(getAuth)
const mockCheckDecision = vi.mocked(checkAuthDecision)

beforeEach(() => {
  vi.clearAllMocks()
  mockOrigin.mockReturnValue(true)
})

describe("/admin/grants loader", () => {
  it("returns the joined grant data", async () => {
    const data = { grants: [{ id: "g1", principalName: "Alice" }] }
    mockRunEffect.mockResolvedValue(data as never)

    const result = await callLoader(loader)
    const loaded = expectData<{ grants: unknown[] }>(result)
    expect(loaded).toEqual(data)
  })
})

describe("/admin/grants action — origin + auth gates", () => {
  it("throws 403 when origin is invalid", async () => {
    mockOrigin.mockReturnValue(false)
    const result = await callAction(action, { formData: { intent: "revoke", grantId: "g1" } })
    expect(expectResponse(result).status).toBe(403)
  })

  it("throws 403 when caller is not an admin", async () => {
    mockGetAuth.mockResolvedValue({ user: "alice", sub: "alice-sub" } as never)
    mockCheckDecision.mockResolvedValue({ allow: false } as never)

    const result = await callAction(action, { formData: { intent: "revoke", grantId: "g1" } })
    expect(expectResponse(result).status).toBe(403)
  })

  it("throws 403 when the session has no principal", async () => {
    mockGetAuth.mockResolvedValue({ user: "alice", sub: "alice-sub" } as never)
    mockCheckDecision.mockResolvedValue({ allow: true } as never)
    mockRunEffect.mockResolvedValueOnce(null as never) // principal lookup miss

    const result = await callAction(action, { formData: { intent: "revoke", grantId: "g1" } })
    expect(expectResponse(result).status).toBe(403)
  })

  it("returns success after revoking the grant on the happy path", async () => {
    mockGetAuth.mockResolvedValue({ user: "admin", sub: "admin-sub" } as never)
    mockCheckDecision.mockResolvedValue({ allow: true } as never)
    mockRunEffect
      .mockResolvedValueOnce({ id: "p-admin" } as never) // principal lookup
      .mockResolvedValueOnce(undefined as never) // revoke + audit + deactivate
    const result = await callAction(action, { formData: { intent: "revoke", grantId: "g1" } })
    const data = expectData<{ success?: boolean }>(result)
    expect(data.success).toBe(true)
  })

  it("returns the unknown-intent error for an unrecognized intent", async () => {
    const result = await callAction(action, { formData: { intent: "doesNotExist" } })
    const data = expectData<{ error?: string }>(result)
    expect(data.error).toBe("Unknown intent")
  })
})

// ===========================================================================
// Component-render tests
// ===========================================================================

import { screen, waitFor } from "@testing-library/react"
import AdminGrantsPage from "./admin.grants"
import { renderRoute } from "~/test/render-route"

const renderPage = (data: { grants: unknown[] }) =>
  renderRoute({
    parentLoaderId: "routes/dashboard",
    parentLoader: () => ({ user: "admin", isAdmin: true }),
    route: {
      path: "/admin/grants",
      Component: AdminGrantsPage as never,
      loader: () => data,
    },
  })

describe("AdminGrantsPage component", () => {
  it("renders one row per grant", async () => {
    renderPage({
      grants: [
        {
          id: "g1",
          principalId: "p-alice",
          principalName: "Alice",
          roleId: "r-editor",
          roleName: "Editor",
          entitlementId: null,
          entitlementName: null,
          applicationName: "Jellyfin",
          applicationId: "app-jelly",
          grantedBy: "p-admin",
          grantedByName: "Admin",
          reason: null,
          expiresAt: null,
          revokedAt: null,
          revokedBy: null,
          createdAt: "2026-01-01T00:00:00Z",
          resourceId: null,
        },
        {
          id: "g2",
          principalId: "p-bob",
          principalName: "Bob",
          roleId: "r-admin",
          roleName: "Admin",
          entitlementId: null,
          entitlementName: null,
          applicationName: "Vault",
          applicationId: "app-vault",
          grantedBy: "p-admin",
          grantedByName: "Admin",
          reason: null,
          expiresAt: null,
          revokedAt: null,
          revokedBy: null,
          createdAt: "2026-01-01T00:00:00Z",
          resourceId: null,
        },
      ],
    })

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument()
    })
    expect(screen.getByText("Bob")).toBeInTheDocument()
  })

  it("survives an empty grants list", async () => {
    renderPage({ grants: [] })
    await waitFor(() => {
      expect(screen.queryByText("Alice")).not.toBeInTheDocument()
    })
  })

  it("renders the application + role names + a Revoke action per grant row", async () => {
    renderPage({
      grants: [
        {
          id: "g-pop",
          principalId: "p-alice",
          principalName: "Alice",
          roleId: "r-editor",
          roleName: "Editor",
          entitlementId: null,
          entitlementName: null,
          applicationName: "Jellyfin",
          applicationId: "app-jelly",
          grantedBy: "p-admin",
          grantedByName: "Admin",
          reason: "promotion",
          expiresAt: null,
          revokedAt: null,
          revokedBy: null,
          createdAt: "2026-01-01T00:00:00Z",
          resourceId: null,
        },
      ],
    })
    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument()
    })
    // The roleName column renders "Editor"; admin column shows "Admin"
    // (granted_by name). Per-row revoke action — at least one button
    // labelled revoke/revoquer is rendered in the populated state.
    expect(screen.getByText("Editor")).toBeInTheDocument()
    const revokeButtons = screen.getAllByRole("button", { name: /revoke|revoquer/i })
    expect(revokeButtons.length).toBeGreaterThan(0)
  })

  it("renders the New Grant CTA in the page header", async () => {
    renderPage({ grants: [] })
    await waitFor(() => {
      // The "Create Grant" link routes the admin to /admin/grants/new.
      // Match the link by name fragment + verify the href.
      const link = screen.getByRole("link", { name: /grant|attribuer/i })
      expect(link).toHaveAttribute("href", expect.stringMatching(/\/admin\/grants\/new/))
    })
  })
})
