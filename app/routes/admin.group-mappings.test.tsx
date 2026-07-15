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
vi.mock("~/lib/admin-guard.server", () => ({
  requireAdmin: vi
    .fn()
    .mockResolvedValue({ sub: "admin", user: "admin", email: "admin@test", groups: ["lldap_admin"] }),
  requireAdminAction: vi
    .fn()
    .mockResolvedValue({ sub: "admin", user: "admin", email: "admin@test", groups: ["lldap_admin"] }),
}))

import { runEffect } from "~/lib/runtime.server"
import { isOriginAllowed } from "~/lib/config.server"
import { getAuth } from "~/lib/auth.server"
import { requireAdmin, requireAdminAction } from "~/lib/admin-guard.server"
import { action, loader } from "./admin.group-mappings"
import { callAction, callLoader, expectData, expectResponse } from "~/test/route-utils"

const mockRunEffect = vi.mocked(runEffect)
const mockOrigin = vi.mocked(isOriginAllowed)
const mockGetAuth = vi.mocked(getAuth)

beforeEach(() => {
  vi.clearAllMocks()
  mockOrigin.mockReturnValue(true)
  mockGetAuth.mockResolvedValue({ user: "admin", sub: "admin-sub" } as never)
})

describe("/admin/group-mappings loader", () => {
  it("returns loader data without throwing", async () => {
    mockRunEffect.mockResolvedValue([] as never)
    const result = await callLoader(loader)
    const data = expectData<unknown>(result)
    expect(data).toBeDefined()
  })

  it("denies a non-admin caller (403) when the guard rejects", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new Response("Forbidden", { status: 403 }))
    const result = await callLoader(loader)
    expect(result.kind).toBe("response")
    if (result.kind === "response") expect(result.response.status).toBe(403)
  })
})

describe("/admin/group-mappings action", () => {
  it("surfaces the guard's 403 when requireAdminAction rejects (non-admin / bad origin)", async () => {
    vi.mocked(requireAdminAction).mockRejectedValueOnce(new Response("Forbidden", { status: 403 }))
    const result = await callAction(action, { formData: { intent: "create" } })
    expect(expectResponse(result).status).toBe(403)
  })

  it("requires oidcGroupName to create", async () => {
    const result = await callAction(action, {
      formData: { intent: "create", oidcGroupName: "  ", mappingType: "group" },
    })
    const data = expectData<{ error?: string }>(result)
    expect(data.error).toContain("OIDC group name")
  })

  it("requires principalGroupId for mappingType=group", async () => {
    const result = await callAction(action, {
      formData: { intent: "create", oidcGroupName: "okta", mappingType: "group", principalGroupId: "" },
    })
    const data = expectData<{ error?: string }>(result)
    expect(data.error).toContain("Principal group")
  })

  it("requires app+role for mappingType=role", async () => {
    const result = await callAction(action, {
      formData: { intent: "create", oidcGroupName: "okta", mappingType: "role", roleId: "" },
    })
    const data = expectData<{ error?: string }>(result)
    expect(data.error).toContain("Application and role")
  })
})

// ===========================================================================
// Component-render tests
// ===========================================================================

import { screen, waitFor } from "@testing-library/react"
import AdminGroupMappingsPage from "./admin.group-mappings"
import { renderRoute } from "~/test/render-route"

const renderPage = (
  data: {
    mappings?: Array<{
      id: string
      oidcGroupName: string
      principalGroupId: string | null
      principalGroupName: string | null
      roleId: string | null
      roleName: string | null
      applicationId: string | null
      applicationName: string | null
      createdAt: string
    }>
    applications?: Array<{ id: string; slug: string; displayName: string }>
    groups?: Array<{ id: string; displayName: string }>
    rolesByApp?: Record<string, Array<{ id: string; displayName: string }>>
  } = {},
) =>
  renderRoute({
    parentLoaderId: "routes/dashboard",
    parentLoader: () => ({ user: "admin", isAdmin: true }),
    route: {
      path: "/admin/group-mappings",
      Component: AdminGroupMappingsPage as never,
      loader: () => ({
        mappings: data.mappings ?? [],
        applications: data.applications ?? [],
        groups: data.groups ?? [],
        rolesByApp: data.rolesByApp ?? {},
      }),
    },
  })

describe("AdminGroupMappingsPage component", () => {
  it("renders each mapping row", async () => {
    renderPage({
      mappings: [
        {
          id: "m1",
          oidcGroupName: "okta-engineers",
          principalGroupId: "g-eng",
          principalGroupName: "Engineering",
          roleId: null,
          roleName: null,
          applicationId: null,
          applicationName: null,
          createdAt: "2026-01-01T00:00:00Z",
        },
        {
          id: "m2",
          oidcGroupName: "okta-editors",
          principalGroupId: null,
          principalGroupName: null,
          roleId: "r-editor",
          roleName: "Editor",
          applicationId: "app-1",
          applicationName: "Jellyfin",
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
    })

    await waitFor(() => {
      expect(screen.getByText("okta-engineers")).toBeInTheDocument()
    })
    expect(screen.getByText("okta-editors")).toBeInTheDocument()
  })

  it("survives an empty mappings list", async () => {
    renderPage({})
    await waitFor(() => {
      expect(screen.queryByText("okta-engineers")).not.toBeInTheDocument()
    })
  })

  it("renders the application name + role for an app-scoped (role) mapping", async () => {
    renderPage({
      mappings: [
        {
          id: "m2",
          oidcGroupName: "okta-admins",
          // app-scoped: principalGroupId is null → target column shows
          // application + role instead of group.
          principalGroupId: null,
          principalGroupName: null,
          roleId: "role-admin",
          roleName: "Admin",
          applicationId: "app-jellyfin",
          applicationName: "Jellyfin",
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
      applications: [{ id: "app-jellyfin", slug: "jellyfin", displayName: "Jellyfin" }],
    })
    await waitFor(() => {
      // Target cell joins with " / "; the same text bubbles up several
      // ancestors, so getAllByText is more robust than expecting a single
      // match.
      const matches = screen.getAllByText((_, node) => Boolean(node?.textContent?.includes("Jellyfin / Admin")))
      expect(matches.length).toBeGreaterThan(0)
    })
  })

  it("renders the Add Group Mapping button", async () => {
    renderPage({
      groups: [{ id: "g-1", displayName: "Engineering" }],
      applications: [{ id: "app-1", slug: "jellyfin", displayName: "Jellyfin" }],
    })
    await waitFor(() => {
      // The button label varies by translation; match by /mapping|mappage/i.
      expect(screen.getByRole("button", { name: /add|nouveau/i })).toBeInTheDocument()
    })
  })
})
