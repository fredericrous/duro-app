import { describe, expect, it, vi, beforeEach } from "vitest"

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

import { requireAuth } from "~/lib/auth.server"
import { runEffect } from "~/lib/runtime.server"
import { parseSettingsMutation, handleSettingsMutation } from "~/lib/mutations/settings"
import { action, loader } from "./settings.certificate"
import { callAction, callLoader, expectData } from "~/test/route-utils"

const mockRequireAuth = vi.mocked(requireAuth)
const mockRunEffect = vi.mocked(runEffect)
const mockParse = vi.mocked(parseSettingsMutation)
const mockHandle = vi.mocked(handleSettingsMutation)

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireAuth.mockResolvedValue({ user: "alice", email: "a@example.com", sub: "s" } as never)
})

describe("/settings/certificate loader", () => {
  it("packages email + cert renewal + certificates", async () => {
    mockRunEffect.mockResolvedValue({
      lastCertRenewalAt: "2026-01-01T00:00:00.000Z",
      p12Password: "pw",
      certificates: [{ id: "c1" }],
    } as never)
    const result = await callLoader(loader)
    const data = expectData<{ email: string; lastCertRenewalAt: string | null; p12Password: string | null }>(result)
    expect(data.email).toBe("a@example.com")
    expect(data.lastCertRenewalAt).toBe("2026-01-01T00:00:00.000Z")
    expect(data.p12Password).toBe("pw")
  })
})

describe("/settings/certificate action", () => {
  it("short-circuits with the parser's error shape", async () => {
    mockParse.mockReturnValue({ error: "Missing serial number" } as never)
    const result = await callAction(action, { formData: { intent: "revokeCert" } })
    const data = expectData<{ error?: string }>(result)
    expect(data).toEqual({ error: "Missing serial number" })
    expect(mockHandle).not.toHaveBeenCalled()
  })

  it("returns the mutation result on success", async () => {
    mockParse.mockReturnValue({ intent: "revokeCert", serialNumber: "AB", auth: {} } as never)
    mockHandle.mockReturnValue("effect" as never)
    mockRunEffect.mockResolvedValue({ certRevoked: true } as never)
    const result = await callAction(action, { formData: { intent: "revokeCert", serialNumber: "AB" } })
    const data = expectData<{ certRevoked?: boolean }>(result)
    expect(data).toEqual({ certRevoked: true })
  })
})

// ===========================================================================
// Component-render test — a certificate's device label renders in the list
// ===========================================================================

import { screen, waitFor } from "@testing-library/react"
import CertificateSettings from "./settings.certificate"
import { renderRoute } from "~/test/render-route"

describe("CertificateSettings component", () => {
  it("renders a certificate's device label", async () => {
    renderRoute({
      route: {
        path: "/settings/certificate",
        Component: CertificateSettings as never,
        loader: () => ({
          email: "a@example.com",
          lastCertRenewalAt: null,
          p12Password: null,
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
            },
          ],
        }),
      },
    })
    await waitFor(() => {
      expect(screen.getByText("MacBook Pro")).toBeInTheDocument()
    })
  })
})
