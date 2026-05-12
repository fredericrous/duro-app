import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))
vi.mock("~/lib/config.server", () => ({
  isOriginAllowed: vi.fn().mockReturnValue(true),
}))
vi.mock("~/lib/auth.server", () => ({
  getAuth: vi.fn(),
}))
vi.mock("~/lib/auth-decision.server", () => ({
  checkAuthDecision: vi.fn(),
}))
vi.mock("~/lib/workflows/grant-activation.server", () => ({
  deactivateGrant: vi.fn(),
}))

import { runEffect } from "~/lib/runtime.server"
import { isOriginAllowed } from "~/lib/config.server"
import { getAuth } from "~/lib/auth.server"
import { checkAuthDecision } from "~/lib/auth-decision.server"
import { action, loader } from "./admin.grants"
import { callAction, callLoader, expectData, expectResponse } from "~/test/route-utils"

const mockRunEffect = vi.mocked(runEffect)
const mockOrigin = vi.mocked(isOriginAllowed)
const mockGetAuth = vi.mocked(getAuth)
const mockCheckDecision = vi.mocked(checkAuthDecision)

beforeEach(() => {
  vi.clearAllMocks()
  mockOrigin.mockReturnValue(true)
})

describe("/admin/grants loader", () => {
  it("returns the joined grant data", async () => {
    const data = { grants: [{ id: "g1", principalName: "Alice" }] }
    mockRunEffect.mockResolvedValue(data as never)

    const result = await callLoader(loader)
    const loaded = expectData<{ grants: unknown[] }>(result)
    expect(loaded).toEqual(data)
  })
})

describe("/admin/grants action — origin + auth gates", () => {
  it("throws 403 when origin is invalid", async () => {
    mockOrigin.mockReturnValue(false)
    const result = await callAction(action, { formData: { intent: "revoke", grantId: "g1" } })
    expect(expectResponse(result).status).toBe(403)
  })

  it("throws 403 when caller is not an admin", async () => {
    mockGetAuth.mockResolvedValue({ user: "alice", sub: "alice-sub" } as never)
    mockCheckDecision.mockResolvedValue({ allow: false } as never)

    const result = await callAction(action, { formData: { intent: "revoke", grantId: "g1" } })
    expect(expectResponse(result).status).toBe(403)
  })

  it("throws 403 when the session has no principal", async () => {
    mockGetAuth.mockResolvedValue({ user: "alice", sub: "alice-sub" } as never)
    mockCheckDecision.mockResolvedValue({ allow: true } as never)
    mockRunEffect.mockResolvedValueOnce(null as never) // principal lookup miss

    const result = await callAction(action, { formData: { intent: "revoke", grantId: "g1" } })
    expect(expectResponse(result).status).toBe(403)
  })
})
