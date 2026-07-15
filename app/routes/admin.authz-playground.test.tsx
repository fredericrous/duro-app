import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))
vi.mock("~/lib/config.server", () => ({
  isOriginAllowed: vi.fn().mockReturnValue(true),
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
import { requireAdmin, requireAdminAction } from "~/lib/admin-guard.server"
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

  it("denies a non-admin caller (403) when the guard rejects", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new Response("Forbidden", { status: 403 }))
    const result = await callLoader(loader)
    expect(result.kind).toBe("response")
    if (result.kind === "response") expect(result.response.status).toBe(403)
  })
})

describe("/admin/authz-playground action", () => {
  it("surfaces the guard's 403 when requireAdminAction rejects (non-admin / bad origin)", async () => {
    vi.mocked(requireAdminAction).mockRejectedValueOnce(new Response("Forbidden", { status: 403 }))
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
import { t } from "~/test/test-utils"

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
    // Page heading is t("admin.authz.title"). The HelpPopover trigger lives
    // inside the heading element, so match by name fragment rather than
    // exact text.
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: new RegExp(t("admin.authz.title"), "i") })).toBeInTheDocument()
    })
    // Two comboboxes (subject + application).
    expect(screen.getAllByRole("combobox").length).toBeGreaterThanOrEqual(2)
  })

  it("survives empty principals + applications lists", async () => {
    renderPage({ principals: [], applications: [] })
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: new RegExp(t("admin.authz.title"), "i") })).toBeInTheDocument()
    })
  })
})
