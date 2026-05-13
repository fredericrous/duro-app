// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest"
import { Effect } from "effect"

// The module reads authMode at import time, so we mock it BEFORE importing
// auth-decision. authMode is a string literal; switching it changes the
// branch the function takes.
vi.mock("./governance-mode.server", () => ({
  get authMode() {
    return mockAuthMode
  },
}))
vi.mock("./runtime.server", () => ({
  runEffect: vi.fn(),
}))
vi.mock("./config.server", () => ({
  config: { adminGroupName: "admins" },
}))

let mockAuthMode: "legacy" | "shadow" | "dual" | "governance" = "legacy"

import { runEffect } from "./runtime.server"
import { checkAuthDecision } from "./auth-decision.server"
import type { AuthInfo } from "./auth.server"

const mockRunEffect = vi.mocked(runEffect)

beforeEach(() => {
  vi.clearAllMocks()
  mockAuthMode = "legacy"
})

const mkAuth = (groups: string[]): AuthInfo => ({ sub: "alice-sub", user: "alice", email: "a@x", groups }) as AuthInfo

describe("checkAuthDecision — legacy mode", () => {
  it("allows admin when the user is in the configured admin group", async () => {
    mockAuthMode = "legacy"
    const result = await checkAuthDecision({ auth: mkAuth(["admins"]), application: "duro", action: "admin" })
    expect(result).toEqual({ allow: true, source: "legacy" })
  })

  it("denies admin when the user lacks the admin group", async () => {
    mockAuthMode = "legacy"
    const result = await checkAuthDecision({ auth: mkAuth(["users"]), application: "duro", action: "admin" })
    expect(result.allow).toBe(false)
    expect(result.source).toBe("legacy")
  })

  it("allows non-admin actions when user has any group", async () => {
    mockAuthMode = "legacy"
    const result = await checkAuthDecision({ auth: mkAuth(["users"]), application: "jellyfin", action: "view" })
    expect(result.allow).toBe(true)
  })

  it("denies when user has no groups (legacy default)", async () => {
    mockAuthMode = "legacy"
    const result = await checkAuthDecision({ auth: mkAuth([]), application: "jellyfin", action: "view" })
    expect(result.allow).toBe(false)
  })
})

describe("checkAuthDecision — governance mode", () => {
  it("uses the governance engine decision (allow) when authMode is 'governance'", async () => {
    mockAuthMode = "governance"
    mockRunEffect.mockResolvedValueOnce({ allow: true, matchedGrantIds: ["g1"], reasons: [] } as never)

    const result = await checkAuthDecision({ auth: mkAuth([]), application: "jellyfin", action: "view" })
    expect(result).toEqual({ allow: true, source: "governance" })
  })

  it("denies (and falls back) when the engine throws — engine-error path", async () => {
    mockAuthMode = "governance"
    mockRunEffect
      .mockRejectedValueOnce(new Error("engine boom") as never) // engine throws
      .mockResolvedValueOnce(undefined as never) // logWarning runs
    const result = await checkAuthDecision({ auth: mkAuth([]), application: "jellyfin", action: "view" })
    expect(result.allow).toBe(false)
  })
})

describe("checkAuthDecision — shadow mode", () => {
  it("returns legacy decision but flags mismatch when governance disagrees", async () => {
    mockAuthMode = "shadow"
    // Legacy: user is in admins group → allow.
    // Governance: deny.
    mockRunEffect
      .mockResolvedValueOnce({ allow: false, matchedGrantIds: [], reasons: [] } as never)
      .mockResolvedValueOnce(undefined as never) // logWarning

    const result = await checkAuthDecision({ auth: mkAuth(["admins"]), application: "duro", action: "admin" })
    expect(result.allow).toBe(true) // legacy wins in shadow mode
    expect(result.source).toBe("legacy")
    expect(result.mismatch).toBe(true)
  })

  it("doesn't flag mismatch when legacy + governance agree", async () => {
    mockAuthMode = "shadow"
    mockRunEffect.mockResolvedValueOnce({ allow: true, matchedGrantIds: ["g1"], reasons: [] } as never)

    const result = await checkAuthDecision({ auth: mkAuth(["admins"]), application: "duro", action: "admin" })
    expect(result.mismatch).toBe(false)
  })
})

describe("checkAuthDecision — dual mode", () => {
  it("prefers governance when it has an opinion (matched grants)", async () => {
    mockAuthMode = "dual"
    mockRunEffect.mockResolvedValueOnce({ allow: true, matchedGrantIds: ["g1"], reasons: [] } as never)
    const result = await checkAuthDecision({ auth: mkAuth([]), application: "jellyfin", action: "view" })
    expect(result).toEqual({ allow: true, source: "governance" })
  })

  it("falls back to legacy when governance has no opinion (empty matched grants + deny)", async () => {
    mockAuthMode = "dual"
    mockRunEffect.mockResolvedValueOnce({ allow: false, matchedGrantIds: [], reasons: [] } as never)
    const result = await checkAuthDecision({ auth: mkAuth(["users"]), application: "jellyfin", action: "view" })
    expect(result.source).toBe("legacy")
    expect(result.allow).toBe(true) // legacy allows any-group users
  })
})
