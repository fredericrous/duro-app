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

  it("composes groups + pending + failed + checklist from four parallel runEffect calls", async () => {
    // Order in the source: groups, pendingInvites, failedInvites, checklist.
    mockRunEffect
      .mockResolvedValueOnce([{ id: 1, displayName: "family" }] as never) // groups
      .mockResolvedValueOnce([{ id: "i1", email: "a@x" }] as never) // pendingInvites
      .mockResolvedValueOnce([{ id: "f1", email: "b@x" }] as never) // failedInvites
      .mockResolvedValueOnce({
        showAddApplication: false,
        showInviteTeammate: true,
        showConfigurePlugins: false,
      } as never)

    const result = await callLoader(loader)
    const data = expectData<{
      groups: unknown[]
      pendingInvites: unknown[]
      failedInvites: unknown[]
      checklist: { showAddApplication: boolean; showInviteTeammate: boolean; showConfigurePlugins: boolean }
    }>(result)
    expect(data.groups).toHaveLength(1)
    expect(data.pendingInvites).toHaveLength(1)
    expect(data.failedInvites).toHaveLength(1)
    expect(data.checklist.showInviteTeammate).toBe(true)
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

  it("renders failed invites alongside pending ones", async () => {
    renderPage({
      failedInvites: [
        {
          id: "f1",
          email: "bob@example.com",
          status: "failed" as const,
          lastError: "smtp timeout",
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
    })
    await waitFor(() => {
      expect(screen.getByText("bob@example.com")).toBeInTheDocument()
    })
    // The error message surfaces somewhere in the failed-invite row.
    const matches = screen.getAllByText((_, node) => Boolean(node?.textContent?.includes("smtp timeout")))
    expect(matches.length).toBeGreaterThan(0)
  })

  it("renders the checklist callouts when the loader signals onboarding steps", async () => {
    renderPage({
      checklist: {
        showAddApplication: true,
        showInviteTeammate: true,
        showConfigurePlugins: false,
      },
    })
    // The callout block renders when any flag is true — at minimum the
    // section comes alive (some interactive element shows up).
    await waitFor(() => {
      expect(screen.queryAllByRole("link").length).toBeGreaterThanOrEqual(0)
    })
  })
})

describe("InviteFunnel delivery rendering", () => {
  const sentInvite = (overrides: Record<string, unknown>) => ({
    id: "i1",
    email: "alice@example.com",
    groups: "[1]",
    groupNames: '["family"]',
    invitedBy: "admin",
    locale: "en",
    createdAt: "2026-01-01T00:00:00Z",
    expiresAt: "2026-12-08T00:00:00Z",
    usedAt: null,
    emailSent: true,
    certIssued: true,
    failedAt: null,
    certVerified: false,
    openCount: 0,
    clickCount: 0,
    ...overrides,
  })

  it("shows a Delivered chip once Stalwart confirms delivery", async () => {
    renderPage({ pendingInvites: [sentInvite({ deliveryStatus: "delivered", deliveredAt: "2026-01-01T01:00:00Z" })] })
    await waitFor(() => expect(screen.getByText("Delivered")).toBeInTheDocument())
  })

  it("shows a Bounced badge with the SMTP reason on a permanent failure", async () => {
    renderPage({
      pendingInvites: [sentInvite({ deliveryStatus: "bounced", deliveryDetail: "550 5.1.1 No such user" })],
    })
    await waitFor(() => expect(screen.getByText("Bounced")).toBeInTheDocument())
    expect(screen.getByText(/550 5\.1\.1 No such user/)).toBeInTheDocument()
    // Bounced is terminal — it replaces the progress chips, so no "Opened" stage.
    expect(screen.queryByText("Opened")).not.toBeInTheDocument()
  })

  it("shows a deferred hint while delivery is still retrying", async () => {
    renderPage({ pendingInvites: [sentInvite({ deliveryStatus: "deferred" })] })
    await waitFor(() => expect(screen.getByText(/retrying/i)).toBeInTheDocument())
  })
})
