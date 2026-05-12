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

import { runEffect } from "~/lib/runtime.server"
import { isOriginAllowed } from "~/lib/config.server"
import { getAuth } from "~/lib/auth.server"
import { checkAuthDecision } from "~/lib/auth-decision.server"
import { action, loader } from "./admin.grants.new"
import { callAction, callLoader, expectData, expectResponse } from "~/test/route-utils"

const mockRunEffect = vi.mocked(runEffect)
const mockOrigin = vi.mocked(isOriginAllowed)
const mockGetAuth = vi.mocked(getAuth)
const mockCheckDecision = vi.mocked(checkAuthDecision)

beforeEach(() => {
  vi.clearAllMocks()
  mockOrigin.mockReturnValue(true)
})

describe("/admin/grants/new loader", () => {
  it("throws 403 when caller isn't an admin", async () => {
    mockGetAuth.mockResolvedValue({ user: "alice", sub: "alice-sub" } as never)
    mockCheckDecision.mockResolvedValue({ allow: false } as never)
    const result = await callLoader(loader)
    expect(expectResponse(result).status).toBe(403)
  })

  it("returns loader data when admin", async () => {
    mockGetAuth.mockResolvedValue({ user: "alice", sub: "alice-sub" } as never)
    mockCheckDecision.mockResolvedValue({ allow: true } as never)
    mockRunEffect.mockResolvedValue([] as never)
    const result = await callLoader(loader)
    expect(expectData<unknown>(result)).toBeDefined()
  })
})

describe("/admin/grants/new action", () => {
  it("throws 403 when origin is invalid", async () => {
    mockOrigin.mockReturnValue(false)
    const result = await callAction(action, { formData: { applicationId: "app-1" } })
    expect(expectResponse(result).status).toBe(403)
  })

  it("throws 403 when caller is not an admin", async () => {
    mockGetAuth.mockResolvedValue({ user: "alice", sub: "alice-sub" } as never)
    mockCheckDecision.mockResolvedValue({ allow: false } as never)
    const result = await callAction(action, { formData: { applicationId: "app-1" } })
    expect(expectResponse(result).status).toBe(403)
  })
})

// =============================================================================
// Component-render tests
// =============================================================================

import { screen, waitFor } from "@testing-library/react"
import AdminGrantsNewPage from "./admin.grants.new"
import { renderRoute } from "~/test/render-route"

const renderPage = (
  data: {
    applications?: Array<{ id: string; slug: string; displayName: string }>
    principals?: Array<{ id: string; principalType: string; displayName: string; email: string | null }>
    rolesByApp?: Record<string, Array<{ id: string; slug: string; displayName: string }>>
    ldapAppIds?: string[]
  } = {},
) =>
  renderRoute({
    parentLoaderId: "routes/dashboard",
    parentLoader: () => ({ user: "admin", isAdmin: true }),
    route: {
      path: "/admin/grants/new",
      Component: AdminGrantsNewPage as never,
      loader: () => ({
        applications: data.applications ?? [{ id: "app-1", slug: "jellyfin", displayName: "Jellyfin" }],
        principals: data.principals ?? [
          { id: "p-alice", principalType: "user", displayName: "Alice", email: "alice@x" },
        ],
        rolesByApp: data.rolesByApp ?? { "app-1": [{ id: "r-1", slug: "viewer", displayName: "Viewer" }] },
        ldapAppIds: data.ldapAppIds ?? [],
      }),
    },
  })

describe("AdminGrantsNewPage component", () => {
  it("renders the form scaffolding (combobox + role select)", async () => {
    renderPage()
    await waitFor(() => {
      // The combobox input renders even with a single auto-selected app —
      // assert via the placeholder so we don't depend on the rendered label.
      expect(screen.getByPlaceholderText(/application/i)).toBeInTheDocument()
    })
  })

  it("survives an empty applications list", async () => {
    renderPage({ applications: [], rolesByApp: {} })
    await waitFor(() => {
      // The page chrome still mounts even when there are no applications.
      expect(screen.getByPlaceholderText(/application/i)).toBeInTheDocument()
    })
  })

  it("renders an actionData error when one is supplied", async () => {
    // The page reads actionData via Route.ComponentProps. We pre-bind it
    // via a wrapper since renderRoute doesn't pass actionData directly.
    const PageWithError = (props: { loaderData: unknown }) => {
      const AnyPage = AdminGrantsNewPage as unknown as (p: {
        loaderData: unknown
        actionData: unknown
      }) => React.ReactElement
      return <AnyPage loaderData={props.loaderData} actionData={{ error: "Insufficient permissions" }} />
    }

    renderRoute({
      parentLoaderId: "routes/dashboard",
      parentLoader: () => ({ user: "admin", isAdmin: true }),
      route: {
        path: "/admin/grants/new",
        Component: PageWithError as never,
        loader: () => ({
          applications: [{ id: "app-1", slug: "jellyfin", displayName: "Jellyfin" }],
          principals: [{ id: "p-alice", principalType: "user", displayName: "Alice", email: "a@x" }],
          rolesByApp: { "app-1": [{ id: "r-1", slug: "viewer", displayName: "Viewer" }] },
          ldapAppIds: [],
        }),
      },
    })
    await waitFor(() => {
      expect(screen.getByText("Insufficient permissions")).toBeInTheDocument()
    })
  })

  it("starts with the never-expires checkbox checked and no date input", async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/application/i)).toBeInTheDocument()
    })
    // Initially neverExpires=true → no date input rendered.
    expect(document.querySelector('input[type="date"]')).toBeNull()
    // The never-expires checkbox is checked by default.
    const checkbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement | null
    expect(checkbox).toBeTruthy()
    expect(checkbox?.checked).toBe(true)
  })
})
