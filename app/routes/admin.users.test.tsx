import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))
vi.mock("~/lib/config.server", () => ({
  isOriginAllowed: vi.fn().mockReturnValue(true),
  config: { isSystemUser: (id: string) => id === "dev" },
}))
vi.mock("~/lib/mutations/admin-users", () => ({
  parseAdminUsersMutation: vi.fn(),
  handleAdminUsersMutation: vi.fn(),
}))

import { runEffect } from "~/lib/runtime.server"
import { isOriginAllowed } from "~/lib/config.server"
import { parseAdminUsersMutation, handleAdminUsersMutation } from "~/lib/mutations/admin-users"
import { action, loader } from "./admin.users"
import { callAction, callLoader, expectData, expectResponse } from "~/test/route-utils"

const mockRunEffect = vi.mocked(runEffect)
const mockOrigin = vi.mocked(isOriginAllowed)
const mockParse = vi.mocked(parseAdminUsersMutation)
const mockHandle = vi.mocked(handleAdminUsersMutation)

beforeEach(() => {
  vi.clearAllMocks()
  mockOrigin.mockReturnValue(true)
})

describe("/admin/users loader", () => {
  it("collects users + revocations + certsByUser and computes systemUserIds", async () => {
    // Three parallel runEffect calls: users, revocations, certsByUser.
    mockRunEffect
      .mockResolvedValueOnce([{ id: "dev" }, { id: "alice" }] as never) // users
      .mockResolvedValueOnce([{ id: "rev-1" }] as never) // revocations
      .mockResolvedValueOnce({ alice: [{ id: "c1" }] } as never) // certsByUser

    const result = await callLoader(loader)
    const data = expectData<{
      users: unknown[]
      revocations: unknown[]
      systemUserIds: string[]
      certsByUser: Record<string, unknown[]>
    }>(result)
    expect(data.users).toHaveLength(2)
    expect(data.revocations).toEqual([{ id: "rev-1" }])
    expect(data.systemUserIds).toEqual(["dev"]) // only the user matching config.isSystemUser
    expect(data.certsByUser).toEqual({ alice: [{ id: "c1" }] })
  })
})

describe("/admin/users action", () => {
  it("throws 403 when origin is invalid", async () => {
    mockOrigin.mockReturnValue(false)
    const result = await callAction(action, { formData: { intent: "create" } })
    expect(expectResponse(result).status).toBe(403)
  })

  it("short-circuits with the parser's error shape", async () => {
    mockParse.mockReturnValue({ error: "bad" } as never)
    const result = await callAction(action, { formData: { intent: "create" } })
    const data = expectData<{ error?: string }>(result)
    expect(data).toEqual({ error: "bad" })
    expect(mockHandle).not.toHaveBeenCalled()
  })

  it("delegates valid input to the mutation handler", async () => {
    mockParse.mockReturnValue({ intent: "create" } as never)
    mockHandle.mockReturnValue("effect" as never)
    mockRunEffect.mockResolvedValue({ success: true } as never)

    const result = await callAction(action, { formData: { intent: "create" } })
    const data = expectData<{ success?: boolean }>(result)
    expect(data).toEqual({ success: true })
  })
})
