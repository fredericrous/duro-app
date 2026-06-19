import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("~/lib/runtime.server", () => ({ runEffect: vi.fn() }))
vi.mock("~/lib/config.server", () => ({
  config: { appName: "Duro", inviteBaseUrl: "https://join.example" },
  isOriginAllowed: vi.fn().mockReturnValue(true),
}))

import { runEffect } from "~/lib/runtime.server"
import { loader as revealLoader, action as revealAction } from "./cert.$revealToken"
import { loader as downloadLoader } from "./cert.$revealToken.download"
import { callLoader, callAction, expectData, expectResponse } from "~/test/route-utils"

const mockRunEffect = vi.mocked(runEffect)
const now = Date.now()
const future = new Date(now + 3600_000).toISOString()

beforeEach(() => vi.clearAllMocks())

describe("/cert/:revealToken loader", () => {
  it("state=ok → returns the password + email for the scratch card", async () => {
    mockRunEffect.mockResolvedValue({
      state: "ok",
      row: { email: "daddy@example.com", expiresAt: future },
      password: "s3cret-pw",
    } as never)

    const data = expectData<{ valid: boolean; revealed: boolean; email: string; password: string }>(
      await callLoader(revealLoader, { params: { revealToken: "tok" } }),
    )
    expect(data.valid).toBe(true)
    expect(data.revealed).toBe(false)
    expect(data.email).toBe("daddy@example.com")
    expect(data.password).toBe("s3cret-pw")
  })

  it("state=revealed → valid but no password (download still offered)", async () => {
    mockRunEffect.mockResolvedValue({
      state: "revealed",
      row: { email: "daddy@example.com", expiresAt: future },
    } as never)

    const data = expectData<{ valid: boolean; revealed: boolean; password?: string }>(
      await callLoader(revealLoader, { params: { revealToken: "tok" } }),
    )
    expect(data.valid).toBe(true)
    expect(data.revealed).toBe(true)
    expect(data.password).toBeUndefined()
  })

  it.each(["invalid", "expired", "consumed"] as const)("state=%s → invalid with matching error", async (state) => {
    mockRunEffect.mockResolvedValue({ state, row: { email: "x", expiresAt: future } } as never)
    const data = expectData<{ valid: boolean; error: string }>(
      await callLoader(revealLoader, { params: { revealToken: "tok" } }),
    )
    expect(data.valid).toBe(false)
    expect(data.error).toBe(state)
  })

  it("missing token → invalid (no runtime call)", async () => {
    const data = expectData<{ valid: boolean; error: string }>(await callLoader(revealLoader, { params: {} }))
    expect(data.valid).toBe(false)
    expect(data.error).toBe("invalid")
    expect(mockRunEffect).not.toHaveBeenCalled()
  })
})

describe("/cert/:revealToken action (reveal POST)", () => {
  it("returns revealed:true when the consume succeeds", async () => {
    mockRunEffect.mockResolvedValue(true as never)
    const data = expectData<{ revealed: boolean }>(
      await callAction(revealAction, { params: { revealToken: "tok" }, formData: { intent: "reveal" } }),
    )
    expect(data.revealed).toBe(true)
  })

  it("ignores a non-reveal intent without touching the runtime", async () => {
    const data = expectData<{ revealed: boolean }>(
      await callAction(revealAction, { params: { revealToken: "tok" }, formData: { intent: "nope" } }),
    )
    expect(data.revealed).toBe(false)
    expect(mockRunEffect).not.toHaveBeenCalled()
  })
})

describe("/cert/:revealToken/download loader", () => {
  it("streams the P12 as an attachment when present", async () => {
    mockRunEffect.mockResolvedValue(Buffer.from("p12-bytes") as never)
    // Success path RETURNS a Response (route-utils only captures *thrown* ones).
    const res = (await downloadLoader({ params: { revealToken: "tok" } } as never)) as Response
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("application/x-pkcs12")
    expect(res.headers.get("Content-Disposition")).toContain("certificate.p12")
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("p12-bytes")
  })

  it("404s when the cert is gone or the link expired", async () => {
    mockRunEffect.mockResolvedValue(null as never)
    const res = expectResponse(await callLoader(downloadLoader, { params: { revealToken: "tok" } }))
    expect(res.status).toBe(404)
  })
})
