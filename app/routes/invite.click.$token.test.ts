import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("~/lib/crypto.server", () => ({
  hashToken: vi.fn((t: string) => `hash(${t})`),
}))

import { runEffect } from "~/lib/runtime.server"
import { loader } from "./invite.click.$token"
import { callLoader, expectResponse } from "~/test/route-utils"

const mockRunEffect = vi.mocked(runEffect)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("/c/:token click redirector", () => {
  it("records the click then 302s to the real invite page", async () => {
    const result = await callLoader(loader, { params: { token: "abc" } })
    const res = expectResponse(result)

    expect(res.status).toBe(302)
    expect(res.headers.get("Location")).toBe("/invite/abc")
    expect(mockRunEffect).toHaveBeenCalledTimes(1)
  })

  it("still redirects for an unknown token (no oracle) — recording is best-effort", async () => {
    const result = await callLoader(loader, { params: { token: "totally-unknown" } })
    const res = expectResponse(result)

    expect(res.status).toBe(302)
    expect(res.headers.get("Location")).toBe("/invite/totally-unknown")
    // recordClick is attempted; the repo matches 0 rows for unknown hashes.
    expect(mockRunEffect).toHaveBeenCalledTimes(1)
  })

  it("redirects without recording when no token is provided", async () => {
    const result = await callLoader(loader, { params: {} })
    const res = expectResponse(result)

    expect(res.status).toBe(302)
    expect(mockRunEffect).not.toHaveBeenCalled()
  })
})
