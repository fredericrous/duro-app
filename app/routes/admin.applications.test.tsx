import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))
vi.mock("~/lib/config.server", () => ({
  isOriginAllowed: vi.fn().mockReturnValue(true),
}))
vi.mock("~/lib/mutations/admin-applications", () => ({
  parseAdminApplicationsMutation: vi.fn(),
  handleAdminApplicationsMutation: vi.fn(),
}))

import { runEffect } from "~/lib/runtime.server"
import { isOriginAllowed } from "~/lib/config.server"
import { parseAdminApplicationsMutation, handleAdminApplicationsMutation } from "~/lib/mutations/admin-applications"
import { action, loader } from "./admin.applications"
import { callAction, callLoader, expectData, expectResponse } from "~/test/route-utils"

const mockRunEffect = vi.mocked(runEffect)
const mockOrigin = vi.mocked(isOriginAllowed)
const mockParse = vi.mocked(parseAdminApplicationsMutation)
const mockHandle = vi.mocked(handleAdminApplicationsMutation)

beforeEach(() => {
  vi.clearAllMocks()
  mockOrigin.mockReturnValue(true)
})

describe("/admin/applications loader", () => {
  it("returns the application list via the repo", async () => {
    const apps = [{ id: "a1", slug: "jellyfin", displayName: "Jellyfin" }]
    mockRunEffect.mockResolvedValue(apps as never)

    const result = await callLoader(loader)
    const data = expectData<{ applications: unknown[] }>(result)
    expect(data.applications).toEqual(apps)
  })
})

describe("/admin/applications action", () => {
  it("throws 403 when origin is invalid", async () => {
    mockOrigin.mockReturnValue(false)

    const result = await callAction(action, { formData: { intent: "create" } })
    const res = expectResponse(result)
    expect(res.status).toBe(403)
  })

  it("returns the parser's error short-circuit", async () => {
    mockParse.mockReturnValue({ error: "missing_slug" } as never)

    const result = await callAction(action, { formData: { intent: "create" } })
    const data = expectData<{ error?: string }>(result)
    expect(data).toEqual({ error: "missing_slug" })
    expect(mockHandle).not.toHaveBeenCalled()
  })

  it("delegates valid input to the mutation handler", async () => {
    mockParse.mockReturnValue({ intent: "create", slug: "x", displayName: "X" } as never)
    mockHandle.mockReturnValue("effect" as never)
    mockRunEffect.mockResolvedValue({ success: true, applicationId: "app-1" } as never)

    const result = await callAction(action, { formData: { intent: "create", slug: "x", displayName: "X" } })
    const data = expectData<{ success?: boolean; applicationId?: string }>(result)
    expect(data).toEqual({ success: true, applicationId: "app-1" })
  })
})

// ===========================================================================
// Component-render tests
// ===========================================================================

import { screen, waitFor } from "@testing-library/react"
import type { Application } from "~/lib/governance/types"
import AdminApplicationsPage from "./admin.applications"
import { renderRoute } from "~/test/render-route"

const mkApp = (o: Partial<Application> & Pick<Application, "id" | "slug">): Application =>
  ({
    displayName: o.slug,
    description: null,
    accessMode: "request",
    enabled: true,
    ownerId: "p-admin",
    url: null,
    lastSyncedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    // Spread last so required id/slug + any overrides win.
    ...o,
  }) as Application

const renderPage = (applications: Application[]) =>
  renderRoute({
    parentLoaderId: "routes/dashboard",
    parentLoader: () => ({ user: "admin", isAdmin: true }),
    route: {
      path: "/admin/applications",
      Component: AdminApplicationsPage as never,
      loader: () => ({ applications }),
    },
  })

describe("AdminApplicationsPage component", () => {
  it("renders one row per application + the access-mode badge", async () => {
    renderPage([
      mkApp({ id: "a1", slug: "jellyfin", displayName: "Jellyfin", accessMode: "open" }),
      mkApp({ id: "a2", slug: "vault", displayName: "Vault", accessMode: "invite_only" }),
    ])

    await waitFor(() => {
      expect(screen.getByText("Jellyfin")).toBeInTheDocument()
    })
    expect(screen.getByText("Vault")).toBeInTheDocument()
    // accessMode badge text
    expect(screen.getByText("open")).toBeInTheDocument()
    expect(screen.getByText("invite_only")).toBeInTheDocument()
  })

  it("survives an empty applications list", async () => {
    renderPage([])
    // No crash; no application rows rendered.
    await waitFor(() => {
      expect(screen.queryByText("Jellyfin")).not.toBeInTheDocument()
    })
  })
})
