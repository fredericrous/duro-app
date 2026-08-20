import { describe, expect, it, vi, beforeEach } from "vitest"
import { Effect } from "effect"

vi.mock("~/lib/auth.server", () => ({
  requireAuth: vi.fn(),
}))
vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))
vi.mock("~/lib/mutations/settings", () => ({
  parseSettingsMutation: vi.fn(),
  handleSettingsMutation: vi.fn(),
}))
vi.mock("~/lib/config.server", () => ({
  isOriginAllowed: vi.fn().mockReturnValue(true),
}))

import { requireAuth } from "~/lib/auth.server"
import { runEffect } from "~/lib/runtime.server"
import { parseSettingsMutation, handleSettingsMutation } from "~/lib/mutations/settings"
import { isOriginAllowed } from "~/lib/config.server"
import { action, loader } from "./devices"
import { callAction, callLoader, expectData } from "~/test/route-utils"

const mockRequireAuth = vi.mocked(requireAuth)
const mockRunEffect = vi.mocked(runEffect)
const mockParse = vi.mocked(parseSettingsMutation)
const mockHandle = vi.mocked(handleSettingsMutation)
const mockOrigin = vi.mocked(isOriginAllowed)

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireAuth.mockResolvedValue({ user: "alice", email: "a@example.com", sub: "s" } as never)
  mockOrigin.mockReturnValue(true)
})

describe("/devices loader", () => {
  it("packages email + device budget + certificates", async () => {
    const budget = { used: 1, limit: 3, nextAvailable: null }
    mockRunEffect.mockResolvedValue({ budget, certificates: [{ id: "c1" }] } as never)
    const result = await callLoader(loader)
    const data = expectData<{ email: string; budget: typeof budget; certificates: unknown[] }>(result)
    expect(data.email).toBe("a@example.com")
    expect(data.budget).toEqual(budget)
    expect(data.certificates).toEqual([{ id: "c1" }])
    // The one-time password is never handed to this page — it is revealed from
    // the emailed link only.
    expect(data).not.toHaveProperty("p12Password")
  })
})

describe("/devices action", () => {
  it("rejects a cross-origin post before touching the mutation", async () => {
    mockOrigin.mockReturnValue(false)
    const result = await callAction(action, {
      formData: { intent: "revokeCert", serialNumber: "AB" },
      headers: { Origin: "http://evil" },
    })
    expect(expectData<Response>(result).status).toBe(403)
    expect(mockParse).not.toHaveBeenCalled()
  })

  it("short-circuits with the parser's error shape", async () => {
    mockParse.mockReturnValue({ error: "Missing serial number" } as never)
    const result = await callAction(action, { formData: { intent: "renewCert" } })
    const data = expectData<{ error?: string }>(result)
    expect(data).toEqual({ error: "Missing serial number" })
    expect(mockHandle).not.toHaveBeenCalled()
  })

  it("returns the mutation result on success", async () => {
    mockParse.mockReturnValue({ intent: "renewCert", serialNumber: "AB", auth: {} } as never)
    // The action pipes the handler through Effect.orDie, so the mock must
    // return a real (pipeable) Effect; the mocked runEffect yields the result.
    mockHandle.mockReturnValue(Effect.void as never)
    mockRunEffect.mockResolvedValue({ certSent: true } as never)
    const result = await callAction(action, { formData: { intent: "renewCert", serialNumber: "AB" } })
    const data = expectData<{ certSent?: boolean }>(result)
    expect(data).toEqual({ certSent: true })
  })
})

// ===========================================================================
// Component-render test — a certificate's device label renders in the list
// ===========================================================================

import { screen, waitFor } from "@testing-library/react"
import DevicesPage from "./devices"
import { renderRoute } from "~/test/render-route"

describe("DevicesPage component", () => {
  it("renders a certificate's device label", async () => {
    renderRoute({
      route: {
        path: "/devices",
        Component: DevicesPage as never,
        loader: () => ({
          email: "a@example.com",
          budget: { used: 0, limit: 3, nextAvailable: null },
          certificates: [
            {
              id: "c1",
              inviteId: null,
              userId: null,
              username: "alice",
              email: "a@example.com",
              label: "MacBook Pro",
              serialNumber: "ABCDEF0123456789",
              issuedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
              revokedAt: null,
              revokeState: null,
              revokeError: null,
              renewedFromSerial: null,
            },
          ],
        }),
      },
      url: "/devices",
    })
    await waitFor(() => {
      expect(screen.getByText("MacBook Pro")).toBeInTheDocument()
    })
  })
})
