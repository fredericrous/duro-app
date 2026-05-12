import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))
vi.mock("~/lib/config.server", () => ({
  config: { appName: "Duro", homeUrl: "https://duro.example.com" },
  isOriginAllowed: vi.fn().mockReturnValue(true),
}))
vi.mock("~/lib/crypto.server", () => ({
  hashToken: vi.fn().mockReturnValue("hashed-token"),
}))
vi.mock("~/lib/i18n.server", () => ({
  resolveLocale: vi.fn().mockReturnValue("en"),
  localeCookieHeader: vi.fn(),
}))

import { runEffect } from "~/lib/runtime.server"
import { loader } from "./invite"
import { callLoader, expectData } from "~/test/route-utils"

const mockRunEffect = vi.mocked(runEffect)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("/invite/:token loader", () => {
  it("returns missing_token error when params.token is absent", async () => {
    const result = await callLoader(loader, { params: {} })
    const data = expectData<{ valid: boolean; error: string }>(result)
    expect(data.valid).toBe(false)
    expect(data.error).toBe("missing_token")
  })

  it("returns invalid error when no invite matches the token hash", async () => {
    mockRunEffect.mockResolvedValue({ invite: null, p12Password: null } as never)

    const result = await callLoader(loader, { params: { token: "abc" } })
    const data = expectData<{ valid: boolean; error: string }>(result)
    expect(data.valid).toBe(false)
    expect(data.error).toBe("invalid")
  })

  it("returns already_used when invite.usedAt is set", async () => {
    mockRunEffect.mockResolvedValue({
      invite: {
        id: "i1",
        usedAt: "2026-01-01T00:00:00Z",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        locale: null,
      },
      p12Password: "pw",
    } as never)

    const result = await callLoader(loader, { params: { token: "abc" } })
    const data = expectData<{ valid: boolean; error: string }>(result)
    expect(data.valid).toBe(false)
    expect(data.error).toBe("already_used")
  })

  it("returns expired when invite has passed expiresAt", async () => {
    mockRunEffect.mockResolvedValue({
      invite: {
        id: "i1",
        usedAt: null,
        expiresAt: new Date(Date.now() - 86400000).toISOString(),
        locale: null,
      },
      p12Password: "pw",
    } as never)

    const result = await callLoader(loader, { params: { token: "abc" } })
    const data = expectData<{ valid: boolean; error: string }>(result)
    expect(data.valid).toBe(false)
    expect(data.error).toBe("expired")
  })
})
