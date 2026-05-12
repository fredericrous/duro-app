import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/runtime.server", async () => {
  const mod = await import("~/test/test-runtime")
  return { runEffect: mod.testRunEffect }
})
vi.mock("~/lib/config.server", () => ({
  config: { appName: "Duro" },
  isOriginAllowed: vi.fn().mockReturnValue(true),
}))
vi.mock("~/lib/crypto.server", () => ({
  hashToken: vi.fn().mockReturnValue("hashed-token"),
}))

import { action, loader } from "./reinvite"
import { truncateAll } from "~/test/test-runtime"
import { callAction, callLoader, expectData } from "~/test/route-utils"

beforeEach(async () => {
  vi.clearAllMocks()
  await truncateAll()
})

describe("/reinvite/:token loader", () => {
  it("returns canReinvite=false / missing_token when params.token is absent", async () => {
    const result = await callLoader(loader, { params: {} })
    const data = expectData<{ canReinvite: boolean; error?: string }>(result)
    expect(data.canReinvite).toBe(false)
    expect(data.error).toBe("missing_token")
  })

  it("returns invalid error when the token doesn't match any invite", async () => {
    const result = await callLoader(loader, { params: { token: "no-such-token" } })
    const data = expectData<{ canReinvite: boolean; error?: string }>(result)
    expect(data.canReinvite).toBe(false)
    expect(data.error).toBeDefined()
  })
})

describe("/reinvite/:token action", () => {
  it("returns missing_token error when params.token is absent", async () => {
    const result = await callAction(action, { params: {} })
    const data = expectData<{ success: boolean; error?: string }>(result)
    expect(data.success).toBe(false)
    expect(data.error).toBe("missing_token")
  })

  it("returns an error shape when the token doesn't match any invite", async () => {
    const result = await callAction(action, { params: { token: "no-such-token" } })
    const data = expectData<{ success: boolean; error?: string }>(result)
    expect(data.success).toBe(false)
  })
})
