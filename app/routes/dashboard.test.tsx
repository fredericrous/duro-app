import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/auth.server", () => ({
  requireAuth: vi.fn(),
}))
vi.mock("~/lib/auth-decision.server", () => ({
  checkAuthDecision: vi.fn(),
}))
vi.mock("~/lib/governance/bootstrap.server", () => ({
  isFirstRun: Symbol("isFirstRunEffect"),
}))
vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))

import { requireAuth } from "~/lib/auth.server"
import { checkAuthDecision } from "~/lib/auth-decision.server"
import { runEffect } from "~/lib/runtime.server"
import { loader } from "./dashboard"
import { callLoader, expectData, expectResponse } from "~/test/route-utils"

const mockRequireAuth = vi.mocked(requireAuth)
const mockCheckDecision = vi.mocked(checkAuthDecision)
const mockRunEffect = vi.mocked(runEffect)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("/dashboard loader", () => {
  it("redirects to /admin/setup when isFirstRun resolves true", async () => {
    mockRunEffect.mockResolvedValueOnce(true as never)

    const result = await callLoader(loader)
    const res = expectResponse(result)
    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.headers.get("location")).toBe("/admin/setup")
    // requireAuth must NOT be called when first-run redirect fires.
    expect(mockRequireAuth).not.toHaveBeenCalled()
  })

  it("returns user/admin shape and resolves currentPrincipalId when authenticated", async () => {
    mockRunEffect
      .mockResolvedValueOnce(false as never) // isFirstRun
      .mockResolvedValueOnce("principal-1" as never) // principal lookup
      .mockResolvedValueOnce(2 as never) // open-request-items count
      .mockResolvedValueOnce({ timezone: "Europe/Paris", timeFormat: "24" } as never) // display prefs
    mockRequireAuth.mockResolvedValue({
      user: "alice",
      email: "alice@example.com",
      groups: ["users"],
      sub: "alice-sub",
    } as never)
    mockCheckDecision.mockResolvedValue({ allow: true } as never)

    const result = await callLoader(loader)
    const data = expectData<{
      user: string
      email: string
      isAdmin: boolean
      currentPrincipalId: string | null
      openRequestItems: number
      timezone: string | null
      timeFormat: string | null
    }>(result)

    expect(data).toEqual({
      user: "alice",
      email: "alice@example.com",
      groups: ["users"],
      isAdmin: true,
      currentPrincipalId: "principal-1",
      openRequestItems: 2,
      timezone: "Europe/Paris",
      timeFormat: "24",
    })
  })

  it("currentPrincipalId is null when the governance lookup throws", async () => {
    mockRunEffect
      .mockResolvedValueOnce(false as never) // isFirstRun
      .mockRejectedValueOnce(new Error("db down")) // principal lookup
      .mockResolvedValueOnce(undefined as never) // logWarning
      .mockResolvedValueOnce({ timezone: null, timeFormat: null } as never) // display prefs
    mockRequireAuth.mockResolvedValue({
      user: "alice",
      email: "alice@example.com",
      groups: [],
      sub: "alice-sub",
    } as never)
    mockCheckDecision.mockResolvedValue({ allow: false } as never)

    const result = await callLoader(loader)
    const data = expectData<{ currentPrincipalId: string | null; isAdmin: boolean }>(result)
    expect(data.currentPrincipalId).toBeNull()
    expect(data.isAdmin).toBe(false)
  })

  it("currentPrincipalId stays null when auth.sub is missing", async () => {
    mockRunEffect
      .mockResolvedValueOnce(false as never) // isFirstRun
      .mockResolvedValueOnce({ timezone: null, timeFormat: null } as never) // display prefs
    mockRequireAuth.mockResolvedValue({
      user: "alice",
      email: "alice@example.com",
      groups: [],
      sub: null,
    } as never)
    mockCheckDecision.mockResolvedValue({ allow: false } as never)

    const result = await callLoader(loader)
    const data = expectData<{ currentPrincipalId: string | null }>(result)
    expect(data.currentPrincipalId).toBeNull()
    // No principal lookup / count without a sub — just isFirstRun + display prefs.
    expect(mockRunEffect).toHaveBeenCalledTimes(2)
  })
})
