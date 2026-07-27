// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest"
import { Effect } from "effect"

// checkAuthDecision handles engine errors INSIDE the Effect (catchAll → deny),
// so the runEffect mock is a passthrough that actually runs the composed
// effect, with a fake AuthzEngine provided as the service the effect yields.
vi.mock("./runtime.server", () => ({
  runEffect: vi.fn(),
}))

import { runEffect } from "./runtime.server"
import { AuthzEngine, AuthzError } from "./governance/AuthzEngine.server"
import { checkAuthDecision } from "./auth-decision.server"
import type { AuthInfo } from "./auth.server"

const mockRunEffect = vi.mocked(runEffect)

type EngineService = typeof AuthzEngine extends { of: (s: infer S) => unknown } ? S : never

const provideEngine = (checkAccess: EngineService["checkAccess"]) => {
  mockRunEffect.mockImplementation(
    (eff) =>
      Effect.runPromise(
        Effect.provideService(eff as Effect.Effect<unknown, never, AuthzEngine>, AuthzEngine, {
          checkAccess,
          checkBulk: () => Effect.die("checkBulk unused in these tests"),
        }),
      ) as never,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

const mkAuth = (): AuthInfo => ({ sub: "alice-sub", user: "alice", email: "a@x", groups: [] }) as AuthInfo

describe("checkAuthDecision (governance)", () => {
  it("allows when the AuthzEngine allows", async () => {
    provideEngine(() => Effect.succeed({ allow: true, matchedGrantIds: ["g1"], reasons: [] }))
    const result = await checkAuthDecision({ auth: mkAuth(), application: "duro", action: "admin" })
    expect(result).toEqual({ allow: true })
  })

  it("denies when the AuthzEngine denies", async () => {
    provideEngine(() => Effect.succeed({ allow: false, matchedGrantIds: [], reasons: [] }))
    const result = await checkAuthDecision({ auth: mkAuth(), application: "duro", action: "admin" })
    expect(result).toEqual({ allow: false })
  })

  it("fails closed (deny) when the engine throws", async () => {
    provideEngine(() => Effect.fail(new AuthzError({ message: "engine boom" })))
    const result = await checkAuthDecision({ auth: mkAuth(), application: "jellyfin", action: "view" })
    expect(result.allow).toBe(false)
  })
})
