// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest"

// checkAuthDecision delegates to the AuthzEngine via runEffect; mock that.
vi.mock("./runtime.server", () => ({
  runEffect: vi.fn(),
}))

import { runEffect } from "./runtime.server"
import { checkAuthDecision } from "./auth-decision.server"
import type { AuthInfo } from "./auth.server"

const mockRunEffect = vi.mocked(runEffect)

beforeEach(() => {
  vi.clearAllMocks()
})

const mkAuth = (): AuthInfo => ({ sub: "alice-sub", user: "alice", email: "a@x", groups: [] }) as AuthInfo

describe("checkAuthDecision (governance)", () => {
  it("allows when the AuthzEngine allows", async () => {
    mockRunEffect.mockResolvedValueOnce({ allow: true, matchedGrantIds: ["g1"], reasons: [] } as never)
    const result = await checkAuthDecision({ auth: mkAuth(), application: "duro", action: "admin" })
    expect(result).toEqual({ allow: true })
  })

  it("denies when the AuthzEngine denies", async () => {
    mockRunEffect.mockResolvedValueOnce({ allow: false, matchedGrantIds: [], reasons: [] } as never)
    const result = await checkAuthDecision({ auth: mkAuth(), application: "duro", action: "admin" })
    expect(result).toEqual({ allow: false })
  })

  it("fails closed (deny) when the engine throws", async () => {
    mockRunEffect
      .mockRejectedValueOnce(new Error("engine boom") as never) // engine throws
      .mockResolvedValueOnce(undefined as never) // logWarning runs
    const result = await checkAuthDecision({ auth: mkAuth(), application: "jellyfin", action: "view" })
    expect(result.allow).toBe(false)
  })
})
