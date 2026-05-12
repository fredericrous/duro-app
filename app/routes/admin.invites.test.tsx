import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))
vi.mock("~/lib/config.server", () => ({
  isOriginAllowed: vi.fn().mockReturnValue(true),
}))
vi.mock("~/lib/mutations/admin-invites", () => ({
  parseAdminInvitesMutation: vi.fn(),
  handleAdminInvitesMutation: vi.fn(),
}))

import { runEffect } from "~/lib/runtime.server"
import { isOriginAllowed } from "~/lib/config.server"
import { parseAdminInvitesMutation, handleAdminInvitesMutation } from "~/lib/mutations/admin-invites"
import { action, loader } from "./admin.invites"
import { callAction, callLoader, expectData, expectResponse } from "~/test/route-utils"

const mockRunEffect = vi.mocked(runEffect)
const mockOrigin = vi.mocked(isOriginAllowed)
const mockParse = vi.mocked(parseAdminInvitesMutation)
const mockHandle = vi.mocked(handleAdminInvitesMutation)

beforeEach(() => {
  vi.clearAllMocks()
  mockOrigin.mockReturnValue(true)
})

describe("/admin/invites loader", () => {
  it("returns loader data", async () => {
    mockRunEffect.mockResolvedValue([] as never)
    const result = await callLoader(loader)
    expect(expectData<unknown>(result)).toBeDefined()
  })
})

describe("/admin/invites action", () => {
  it("throws 403 when origin is invalid", async () => {
    mockOrigin.mockReturnValue(false)
    const result = await callAction(action, { formData: { intent: "create" } })
    expect(expectResponse(result).status).toBe(403)
  })

  it("short-circuits with the parser's error shape", async () => {
    mockParse.mockReturnValue({ error: "bad" } as never)
    const result = await callAction(action, { formData: { intent: "create" } })
    expect(expectData<{ error?: string }>(result)).toEqual({ error: "bad" })
  })

  it("delegates to the mutation handler", async () => {
    mockParse.mockReturnValue({ intent: "create" } as never)
    mockHandle.mockReturnValue("effect" as never)
    mockRunEffect.mockResolvedValue({ success: true } as never)
    const result = await callAction(action, { formData: { intent: "create" } })
    expect(expectData<{ success?: boolean }>(result)).toEqual({ success: true })
  })
})

// ===========================================================================
// Component-render tests
// ===========================================================================

import { screen, waitFor } from "@testing-library/react"
import AdminInvitesPage from "./admin.invites"
import { renderRoute } from "~/test/render-route"

const renderPage = (
  data: {
    groups?: Array<{ id: number; displayName: string }>
    pendingInvites?: unknown[]
    failedInvites?: unknown[]
    checklist?: { showAddApplication: boolean; showInviteTeammate: boolean; showConfigurePlugins: boolean }
  } = {},
) =>
  renderRoute({
    parentLoaderId: "routes/dashboard",
    parentLoader: () => ({ user: "admin", isAdmin: true }),
    route: {
      path: "/admin/invites",
      Component: AdminInvitesPage as never,
      loader: () => ({
        groups: data.groups ?? [{ id: 1, displayName: "family" }],
        pendingInvites: data.pendingInvites ?? [],
        failedInvites: data.failedInvites ?? [],
        checklist: data.checklist ?? {
          showAddApplication: false,
          showInviteTeammate: false,
          showConfigurePlugins: false,
        },
      }),
    },
  })

describe("AdminInvitesPage component", () => {
  it("renders the invite form even when there are no pending/failed invites", async () => {
    renderPage({})
    await waitFor(() => {
      // There's always an "emails" input on the form.
      expect(screen.queryAllByRole("textbox").length).toBeGreaterThan(0)
    })
  })

  it("renders a pending invites section when at least one is pending", async () => {
    renderPage({
      pendingInvites: [
        {
          id: "i1",
          email: "alice@example.com",
          groups: "[1]",
          groupNames: '["family"]',
          invitedBy: "admin",
          locale: "en",
          createdAt: "2026-01-01T00:00:00Z",
          expiresAt: "2026-01-08T00:00:00Z",
          usedAt: null,
        },
      ],
    })
    await waitFor(() => {
      expect(screen.getByText("alice@example.com")).toBeInTheDocument()
    })
  })
})
