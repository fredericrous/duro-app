import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn().mockResolvedValue(undefined),
}))

import { runEffect } from "~/lib/runtime.server"
import { loader } from "./invite.open.$openToken"
import { callLoader, expectData } from "~/test/route-utils"

const mockRunEffect = vi.mocked(runEffect)

beforeEach(() => {
  vi.clearAllMocks()
})

async function loadPixel(input: Parameters<typeof callLoader>[1]) {
  const result = await callLoader(loader, input)
  return expectData<Response>(result)
}

describe("/e/:openToken pixel loader", () => {
  it("returns a 1x1 GIF with no-store caching for a valid token", async () => {
    const res = await loadPixel({ params: { openToken: "open-abc" } })

    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("image/gif")
    expect(res.headers.get("Cache-Control")).toContain("no-store")

    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(bytes.byteLength).toBeGreaterThan(0)
    // GIF magic header "GIF8"
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("GIF8")
  })

  it("records the open (calls runEffect) when a token is present", async () => {
    await loadPixel({ params: { openToken: "open-abc" } })
    expect(mockRunEffect).toHaveBeenCalledTimes(1)
  })

  it("returns the same GIF for an unknown token (no oracle), still recording the attempt", async () => {
    const res = await loadPixel({ params: { openToken: "totally-unknown" } })
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("image/gif")
    // recordOpen is attempted; the repo simply matches 0 rows for unknown tokens.
    expect(mockRunEffect).toHaveBeenCalledTimes(1)
  })

  it("returns the GIF without recording when no token is provided", async () => {
    const res = await loadPixel({ params: {} })
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("image/gif")
    expect(mockRunEffect).not.toHaveBeenCalled()
  })
})
