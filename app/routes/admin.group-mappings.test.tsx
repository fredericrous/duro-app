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

import { runEffect } from "~/lib/runtime.server"
import { isOriginAllowed } from "~/lib/config.server"
import { getAuth } from "~/lib/auth.server"
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
})

describe("/admin/group-mappings action", () => {
  it("throws 403 when origin is invalid", async () => {
    mockOrigin.mockReturnValue(false)
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
})
