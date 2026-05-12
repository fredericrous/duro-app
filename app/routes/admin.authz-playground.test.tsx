import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))
vi.mock("~/lib/config.server", () => ({
  isOriginAllowed: vi.fn().mockReturnValue(true),
}))

import { runEffect } from "~/lib/runtime.server"
import { isOriginAllowed } from "~/lib/config.server"
import { action, loader } from "./admin.authz-playground"
import { callAction, callLoader, expectData, expectResponse } from "~/test/route-utils"

const mockRunEffect = vi.mocked(runEffect)
const mockOrigin = vi.mocked(isOriginAllowed)

beforeEach(() => {
  vi.clearAllMocks()
  mockOrigin.mockReturnValue(true)
})

describe("/admin/authz-playground loader", () => {
  it("returns the loader data", async () => {
    mockRunEffect.mockResolvedValue([] as never)
    const result = await callLoader(loader)
    expect(expectData<unknown>(result)).toBeDefined()
  })
})

describe("/admin/authz-playground action", () => {
  it("throws 403 when origin is invalid", async () => {
    mockOrigin.mockReturnValue(false)
    const result = await callAction(action, { formData: { intent: "checkAccess" } })
    expect(expectResponse(result).status).toBe(403)
  })
})

// ===========================================================================
// Component-render tests
// ===========================================================================

import { screen, waitFor } from "@testing-library/react"
import AdminAuthzPlaygroundPage from "./admin.authz-playground"
import { renderRoute } from "~/test/render-route"

const renderPage = (
  data: {
    principals?: Array<{ id: string; displayName: string; externalId: string | null }>
    applications?: Array<{ id: string; slug: string; displayName: string }>
  } = {},
) =>
  renderRoute({
    parentLoaderId: "routes/dashboard",
    parentLoader: () => ({ user: "admin", isAdmin: true }),
    route: {
      path: "/admin/authz-playground",
      Component: AdminAuthzPlaygroundPage as never,
      loader: () => ({
        principals: data.principals ?? [{ id: "p-alice", displayName: "Alice", externalId: "alice-sub" }],
        applications: data.applications ?? [{ id: "app-1", slug: "jellyfin", displayName: "Jellyfin" }],
      }),
    },
  })

describe("AdminAuthzPlaygroundPage component", () => {
  it("renders the page header + subject/application comboboxes", async () => {
    renderPage()
    await waitFor(() => {
      // Page has a Heading title.
      expect(screen.getByRole("heading")).toBeInTheDocument()
    })
    // Two comboboxes (subject + application).
    expect(screen.getAllByRole("combobox").length).toBeGreaterThanOrEqual(2)
  })

  it("survives empty principals + applications lists", async () => {
    renderPage({ principals: [], applications: [] })
    await waitFor(() => {
      expect(screen.getByRole("heading")).toBeInTheDocument()
    })
  })
})
