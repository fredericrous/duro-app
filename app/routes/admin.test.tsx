import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/auth.server", () => ({
  getAuth: vi.fn(),
}))
vi.mock("~/lib/auth-decision.server", () => ({
  checkAuthDecision: vi.fn(),
}))
vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))

import { getAuth } from "~/lib/auth.server"
import { checkAuthDecision } from "~/lib/auth-decision.server"
import { runEffect } from "~/lib/runtime.server"
import { loader } from "./admin"
import { callLoader, expectData, expectResponse } from "~/test/route-utils"

const mockGetAuth = vi.mocked(getAuth)
const mockCheckDecision = vi.mocked(checkAuthDecision)
const mockRunEffect = vi.mocked(runEffect)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("/admin layout loader", () => {
  it("throws 403 when caller isn't an admin", async () => {
    mockGetAuth.mockResolvedValue({ user: "alice", sub: "alice-sub" } as never)
    mockCheckDecision.mockResolvedValue({ allow: false } as never)
    const result = await callLoader(loader)
    expect(expectResponse(result).status).toBe(403)
  })

  it("returns pendingCounts when admin", async () => {
    mockGetAuth.mockResolvedValue({ user: "alice", sub: "alice-sub" } as never)
    mockCheckDecision.mockResolvedValue({ allow: true } as never)
    mockRunEffect.mockResolvedValue({ accessRequests: 3, accessInvitations: 1 } as never)

    const result = await callLoader(loader)
    const data = expectData<{ pendingCounts: { accessRequests: number; accessInvitations: number } }>(result)
    expect(data.pendingCounts.accessRequests).toBe(3)
    expect(data.pendingCounts.accessInvitations).toBe(1)
  })
})
