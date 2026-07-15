import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/runtime.server", () => ({ runEffect: vi.fn() }))
vi.mock("~/lib/admin-guard.server", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ sub: "admin-sub", user: "admin", email: "a@b", groups: ["lldap_admin"] }),
  requireAdminAction: vi.fn().mockResolvedValue({
    sub: "admin-sub",
    user: "admin",
    email: "a@b",
    groups: ["lldap_admin"],
  }),
}))
vi.mock("~/lib/auth.server", () => ({ getAuth: vi.fn() }))

import { runEffect } from "~/lib/runtime.server"
import { requireAdmin, requireAdminAction } from "~/lib/admin-guard.server"
import { getAuth } from "~/lib/auth.server"
import { action, loader } from "./admin.invitations"
import { callAction, callLoader, expectData } from "~/test/route-utils"

const mockRunEffect = vi.mocked(runEffect)
const mockGetAuth = vi.mocked(getAuth)

beforeEach(() => {
  vi.clearAllMocks()
  mockGetAuth.mockResolvedValue({ user: "admin", sub: "admin-sub", groups: ["lldap_admin"] } as never)
})

describe("/admin/invitations loader", () => {
  it("returns the enriched invitations plus form data", async () => {
    mockRunEffect.mockResolvedValueOnce({
      invitations: [{ id: "inv-1" }, { id: "inv-2" }],
      applications: [{ id: "app-1" }],
      principals: [{ id: "p-1" }],
      rolesByApp: {},
      entitlementsByApp: {},
    } as never)

    const result = await callLoader(loader)
    const data = expectData<{ invitations: unknown[]; applications: unknown[]; principals: unknown[] }>(result)
    expect(data.invitations).toHaveLength(2)
    expect(data.applications).toHaveLength(1)
    expect(data.principals).toHaveLength(1)
  })

  it("denies a non-admin (403)", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new Response("Forbidden", { status: 403 }))
    const result = await callLoader(loader)
    expect(result.kind).toBe("response")
    if (result.kind === "response") expect(result.response.status).toBe(403)
  })
})

describe("/admin/invitations action", () => {
  // The action resolves the admin's principal first (runEffect #1), then
  // validates. Default that lookup to a real principal id.
  beforeEach(() => {
    mockRunEffect.mockResolvedValue({ id: "p-admin" } as never)
  })

  it("surfaces the guard's 403 when requireAdminAction rejects", async () => {
    vi.mocked(requireAdminAction).mockRejectedValueOnce(new Response("Forbidden", { status: 403 }))
    const result = await callAction(action, { formData: { intent: "createInvitation" } })
    expect(result.kind).toBe("response")
    if (result.kind === "response") expect(result.response.status).toBe(403)
  })

  it("requires application and principal", async () => {
    const result = await callAction(action, {
      formData: { intent: "createInvitation", applicationId: "", invitedPrincipalId: "" },
    })
    expect(expectData<{ error?: string }>(result)).toEqual({ error: "app_and_principal_required" })
  })

  it("requires exactly one of role / entitlement — none given", async () => {
    const result = await callAction(action, {
      formData: { intent: "createInvitation", applicationId: "app-1", invitedPrincipalId: "p-1" },
    })
    expect(expectData<{ error?: string }>(result)).toEqual({ error: "target_required" })
  })

  it("rejects both role and entitlement together", async () => {
    const result = await callAction(action, {
      formData: {
        intent: "createInvitation",
        applicationId: "app-1",
        invitedPrincipalId: "p-1",
        roleId: "role-1",
        entitlementId: "ent-1",
      },
    })
    expect(expectData<{ error?: string }>(result)).toEqual({ error: "target_exclusive" })
  })

  it("creates an invitation and reports success", async () => {
    // runEffect #1 = admin lookup, #2 = the create effect.
    mockRunEffect.mockReset()
    mockRunEffect.mockResolvedValueOnce({ id: "p-admin" } as never).mockResolvedValueOnce({ ok: true } as never)
    const result = await callAction(action, {
      formData: { intent: "createInvitation", applicationId: "app-1", invitedPrincipalId: "p-1", roleId: "role-1" },
    })
    expect(expectData<{ success?: string }>(result)).toEqual({ success: "created" })
  })
})

// ===========================================================================
// Component-render tests
// ===========================================================================

import { screen, waitFor } from "@testing-library/react"
import AdminInvitationsPage from "./admin.invitations"
import { renderRoute } from "~/test/render-route"

const renderPage = (
  data: {
    invitations?: unknown[]
    applications?: unknown[]
    principals?: unknown[]
    rolesByApp?: Record<string, unknown[]>
    entitlementsByApp?: Record<string, unknown[]>
  } = {},
) =>
  renderRoute({
    parentLoaderId: "routes/dashboard",
    parentLoader: () => ({ user: "admin", isAdmin: true }),
    route: {
      path: "/admin/invitations",
      Component: AdminInvitationsPage as never,
      loader: () => ({
        invitations: data.invitations ?? [],
        applications: data.applications ?? [],
        principals: data.principals ?? [],
        rolesByApp: data.rolesByApp ?? {},
        entitlementsByApp: data.entitlementsByApp ?? {},
      }),
    },
  })

describe("AdminInvitationsPage component", () => {
  it("renders enriched rows with translated status", async () => {
    renderPage({
      invitations: [
        {
          id: "i1",
          status: "pending",
          applicationId: "app-1",
          applicationName: "Jellyfin",
          roleId: "role-1",
          roleName: "Viewer",
          entitlementId: null,
          entitlementName: null,
          invitedPrincipalId: "p-alice",
          invitedPrincipalName: "Alice",
          invitedByName: "Admin",
          message: "welcome!",
          createdAt: "2026-01-01T00:00:00Z",
          expiresAt: null,
        },
        {
          id: "i2",
          status: "accepted",
          applicationId: "app-1",
          applicationName: "Jellyfin",
          roleId: null,
          roleName: null,
          entitlementId: "ent-1",
          entitlementName: "Read",
          invitedPrincipalId: "p-bob",
          invitedPrincipalName: "Bob",
          invitedByName: "Admin",
          message: null,
          createdAt: "2026-01-01T00:00:00Z",
          expiresAt: null,
        },
      ],
    })

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument()
    })
    // Translated status labels (admin.invitations.status.*).
    expect(screen.getByText("Pending")).toBeInTheDocument()
    expect(screen.getByText("Accepted")).toBeInTheDocument()
    expect(screen.getByText("Bob")).toBeInTheDocument()
    // Cancel button only on the pending row.
    expect(screen.getAllByRole("button", { name: /Cancel/i })).toHaveLength(1)
  })

  it("shows the empty state with no invitations", async () => {
    renderPage({})
    await waitFor(() => {
      expect(screen.queryByText("Pending")).not.toBeInTheDocument()
    })
  })
})
