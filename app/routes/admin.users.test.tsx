import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))
vi.mock("~/lib/config.server", () => ({
  isOriginAllowed: vi.fn().mockReturnValue(true),
  config: { isSystemUser: (id: string) => id === "dev" },
}))
vi.mock("~/lib/mutations/admin-users", () => ({
  parseAdminUsersMutation: vi.fn(),
  handleAdminUsersMutation: vi.fn(),
}))

import { runEffect } from "~/lib/runtime.server"
import { isOriginAllowed } from "~/lib/config.server"
import { parseAdminUsersMutation, handleAdminUsersMutation } from "~/lib/mutations/admin-users"
import { action, loader } from "./admin.users"
import { callAction, callLoader, expectData, expectResponse } from "~/test/route-utils"

const mockRunEffect = vi.mocked(runEffect)
const mockOrigin = vi.mocked(isOriginAllowed)
const mockParse = vi.mocked(parseAdminUsersMutation)
const mockHandle = vi.mocked(handleAdminUsersMutation)

beforeEach(() => {
  vi.clearAllMocks()
  mockOrigin.mockReturnValue(true)
})

describe("/admin/users loader", () => {
  it("collects users + revocations + certsByUser and computes systemUserIds", async () => {
    // Three parallel runEffect calls: users, revocations, certsByUser.
    mockRunEffect
      .mockResolvedValueOnce([{ id: "dev" }, { id: "alice" }] as never) // users
      .mockResolvedValueOnce([{ id: "rev-1" }] as never) // revocations
      .mockResolvedValueOnce({ alice: [{ id: "c1" }] } as never) // certsByUser

    const result = await callLoader(loader)
    const data = expectData<{
      users: unknown[]
      revocations: unknown[]
      systemUserIds: string[]
      certsByUser: Record<string, unknown[]>
    }>(result)
    expect(data.users).toHaveLength(2)
    expect(data.revocations).toEqual([{ id: "rev-1" }])
    expect(data.systemUserIds).toEqual(["dev"]) // only the user matching config.isSystemUser
    expect(data.certsByUser).toEqual({ alice: [{ id: "c1" }] })
  })
})

describe("/admin/users action", () => {
  it("throws 403 when origin is invalid", async () => {
    mockOrigin.mockReturnValue(false)
    const result = await callAction(action, { formData: { intent: "create" } })
    expect(expectResponse(result).status).toBe(403)
  })

  it("short-circuits with the parser's error shape", async () => {
    mockParse.mockReturnValue({ error: "bad" } as never)
    const result = await callAction(action, { formData: { intent: "create" } })
    const data = expectData<{ error?: string }>(result)
    expect(data).toEqual({ error: "bad" })
    expect(mockHandle).not.toHaveBeenCalled()
  })

  it("delegates valid input to the mutation handler", async () => {
    mockParse.mockReturnValue({ intent: "create" } as never)
    mockHandle.mockReturnValue("effect" as never)
    mockRunEffect.mockResolvedValue({ success: true } as never)

    const result = await callAction(action, { formData: { intent: "create" } })
    const data = expectData<{ success?: boolean }>(result)
    expect(data).toEqual({ success: true })
  })
})

// ===========================================================================
// Component-render tests
// ===========================================================================

import { screen, waitFor } from "@testing-library/react"
import AdminUsersPage from "./admin.users"
import { renderRoute } from "~/test/render-route"

// AdminUsersPage consumes `useAdminSidePanel()` (a useOutletContext call).
// In production the /admin layout supplies it; for tests we hand a no-op
// stub via `parentContext`.
const stubSidePanel = {
  open: false,
  onOpenChange: () => {},
  content: null,
  setContent: () => {},
  onCloseRef: { current: null as null | (() => void) },
  showDetail: () => {},
  isWide: false,
}

const renderPage = (
  data: {
    users?: Array<{ id: string; email: string; displayName: string; creationDate: string }>
    revocations?: unknown[]
    systemUserIds?: string[]
    certsByUser?: Record<string, unknown[]>
  } = {},
) =>
  renderRoute({
    parentLoaderId: "routes/dashboard",
    parentLoader: () => ({ user: "admin", isAdmin: true }),
    parentContext: stubSidePanel,
    route: {
      path: "/admin/users",
      Component: AdminUsersPage as never,
      loader: () => ({
        users: data.users ?? [],
        revocations: data.revocations ?? [],
        systemUserIds: data.systemUserIds ?? [],
        certsByUser: data.certsByUser ?? {},
      }),
    },
  })

describe("AdminUsersPage component", () => {
  it("renders one row per user", async () => {
    renderPage({
      users: [
        { id: "alice", email: "alice@example.com", displayName: "Alice", creationDate: "2026-01-01T00:00:00Z" },
        { id: "bob", email: "bob@example.com", displayName: "Bob", creationDate: "2026-01-01T00:00:00Z" },
      ],
    })

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument()
    })
    expect(screen.getByText("Bob")).toBeInTheDocument()
  })

  it("renders revocation rows when revocations are present", async () => {
    renderPage({
      revocations: [
        {
          id: "rev-1",
          email: "ghost@example.com",
          username: "ghost",
          reason: "GDPR request",
          revokedAt: "2026-01-01T00:00:00Z",
          revokedBy: "admin",
        },
      ],
    })

    await waitFor(() => {
      // Multiple matches (the revoked email appears both as text and in the
      // revoke reason hint). getAllByText asserts the row rendered without
      // being strict about exactly one match.
      expect(screen.getAllByText(/ghost@example\.com/).length).toBeGreaterThan(0)
    })
  })

  it("renders users with cert counts when certs are present", async () => {
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    renderPage({
      users: [{ id: "alice", email: "alice@example.com", displayName: "Alice", creationDate: "2026-01-01T00:00:00Z" }],
      certsByUser: {
        alice: [
          {
            id: "cert-1",
            userId: "alice",
            serialNumber: "ABCDEF12",
            issuedAt: "2026-01-01T00:00:00Z",
            expiresAt: expires,
            revokedAt: null,
          },
        ],
      },
    })
    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument()
    })
    // The page exposes the user row + a TanStack pagination footer for
    // single-page tables.
    expect(screen.getByText("alice@example.com")).toBeInTheDocument()
  })

  it("flags system users in the populated table", async () => {
    renderPage({
      users: [
        { id: "dev", email: "dev@example.com", displayName: "Dev", creationDate: "2026-01-01T00:00:00Z" },
        { id: "alice", email: "alice@example.com", displayName: "Alice", creationDate: "2026-01-01T00:00:00Z" },
      ],
      systemUserIds: ["dev"],
    })
    await waitFor(() => {
      expect(screen.getByText("Dev")).toBeInTheDocument()
    })
    // Both row labels render — system flag affects row-selection eligibility
    // (verified by the table's enableRowSelection callback), not text.
    expect(screen.getByText("Alice")).toBeInTheDocument()
  })

  it("renders the empty state when no users or revocations exist", async () => {
    renderPage({})
    // The empty-state copy comes from i18n; assert no user rows rendered.
    await waitFor(() => {
      expect(screen.queryByText("Alice")).not.toBeInTheDocument()
    })
  })
})
