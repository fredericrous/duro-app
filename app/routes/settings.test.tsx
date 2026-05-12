import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/auth.server", () => ({
  requireAuth: vi.fn(),
}))
vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))
vi.mock("~/lib/i18n.server", () => ({
  resolveLocale: vi.fn().mockReturnValue("en"),
}))
vi.mock("~/lib/config.server", () => ({
  config: { autheliaUrl: "https://auth.example.com" },
}))
vi.mock("~/lib/mutations/settings", () => ({
  parseSettingsMutation: vi.fn(),
  handleSettingsMutation: vi.fn(),
}))

import { requireAuth } from "~/lib/auth.server"
import { runEffect } from "~/lib/runtime.server"
import { parseSettingsMutation, handleSettingsMutation } from "~/lib/mutations/settings"
import { action, loader } from "./settings"
import { callAction, callLoader, expectData } from "~/test/route-utils"

const mockRequireAuth = vi.mocked(requireAuth)
const mockRunEffect = vi.mocked(runEffect)
const mockParse = vi.mocked(parseSettingsMutation)
const mockHandle = vi.mocked(handleSettingsMutation)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("/settings loader", () => {
  it("packages locale + cert renewal + certificates into loaderData", async () => {
    mockRequireAuth.mockResolvedValue({ user: "alice", email: "a@example.com", sub: "s" } as never)
    mockRunEffect.mockResolvedValue({
      locale: "fr",
      lastCertRenewal: { at: new Date("2026-01-01T00:00:00Z"), renewalId: "r1" },
      p12Password: "pw",
      certificates: [{ id: "c1" }],
    } as never)

    const result = await callLoader(loader)
    const data = expectData<{
      locale: string
      currentLocale: string
      email: string
      lastCertRenewalAt: string | null
      p12Password: string | null
      certificates: unknown[]
      autheliaUrl?: string
    }>(result)

    expect(data.locale).toBe("fr")
    expect(data.currentLocale).toBe("en")
    expect(data.email).toBe("a@example.com")
    expect(data.lastCertRenewalAt).toBe("2026-01-01T00:00:00.000Z")
    expect(data.p12Password).toBe("pw")
    expect(data.certificates).toEqual([{ id: "c1" }])
    expect(data.autheliaUrl).toBe("https://auth.example.com")
  })

  it("handles null lastCertRenewal.at without crashing", async () => {
    mockRequireAuth.mockResolvedValue({ user: "alice", email: "a@x", sub: "s" } as never)
    mockRunEffect.mockResolvedValue({
      locale: "en",
      lastCertRenewal: { at: null, renewalId: null },
      p12Password: null,
      certificates: [],
    } as never)

    const result = await callLoader(loader)
    const data = expectData<{ lastCertRenewalAt: string | null; p12Password: string | null }>(result)
    expect(data.lastCertRenewalAt).toBeNull()
    expect(data.p12Password).toBeNull()
  })
})

describe("/settings action", () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue({ user: "alice", email: "a@x", sub: "s" } as never)
  })

  it("short-circuits with the parser's error shape", async () => {
    mockParse.mockReturnValue({ error: "bad_input" } as never)

    const result = await callAction(action, { formData: { intent: "saveLocale", locale: "" } })
    const data = expectData<{ error?: string }>(result)
    expect(data).toEqual({ error: "bad_input" })
    expect(mockHandle).not.toHaveBeenCalled()
  })

  it("returns the mutation result directly when no _redirect marker is set", async () => {
    mockParse.mockReturnValue({ intent: "saveLocale", locale: "fr", username: "alice" } as never)
    mockHandle.mockReturnValue("placeholder-effect" as never)
    mockRunEffect.mockResolvedValue({ success: true } as never)

    const result = await callAction(action, { formData: { intent: "saveLocale", locale: "fr" } })
    const data = expectData<{ success?: boolean }>(result)
    expect(data).toEqual({ success: true })
  })

  it("converts a _redirect+_cookie marker into a 302 Response", async () => {
    mockParse.mockReturnValue({ intent: "saveLocale", locale: "fr", username: "alice" } as never)
    mockHandle.mockReturnValue("placeholder-effect" as never)
    mockRunEffect.mockResolvedValue({
      _redirect: "/settings",
      _cookie: "duro_lng=fr; Path=/; Max-Age=31536000",
    } as never)

    const result = await callAction(action, { formData: { intent: "saveLocale", locale: "fr" } })
    // react-router's `redirect()` returns a Response (it doesn't throw), so
    // the helper resolves it as `kind: "data"` with the Response as the value.
    const res = expectData<Response>(result)
    expect(res).toBeInstanceOf(Response)
    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.headers.get("location")).toBe("/settings")
    expect(res.headers.get("set-cookie")).toContain("duro_lng=fr")
  })
})
