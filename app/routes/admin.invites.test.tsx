import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))
vi.mock("~/lib/config.server", () => ({
  isOriginAllowed: vi.fn().mockReturnValue(true),
}))
vi.mock("~/lib/mutations/admin-invites", () => ({
  parseAdminInvitesMutation: vi.fn(),
  handleAdminInvitesMutation: vi.fn(),
}))

import { runEffect } from "~/lib/runtime.server"
import { isOriginAllowed } from "~/lib/config.server"
import { parseAdminInvitesMutation, handleAdminInvitesMutation } from "~/lib/mutations/admin-invites"
import { action, loader } from "./admin.invites"
import { callAction, callLoader, expectData, expectResponse } from "~/test/route-utils"

const mockRunEffect = vi.mocked(runEffect)
const mockOrigin = vi.mocked(isOriginAllowed)
const mockParse = vi.mocked(parseAdminInvitesMutation)
const mockHandle = vi.mocked(handleAdminInvitesMutation)

beforeEach(() => {
  vi.clearAllMocks()
  mockOrigin.mockReturnValue(true)
})

describe("/admin/invites loader", () => {
  it("returns loader data", async () => {
    mockRunEffect.mockResolvedValue([] as never)
    const result = await callLoader(loader)
    expect(expectData<unknown>(result)).toBeDefined()
  })
})

describe("/admin/invites action", () => {
  it("throws 403 when origin is invalid", async () => {
    mockOrigin.mockReturnValue(false)
    const result = await callAction(action, { formData: { intent: "create" } })
    expect(expectResponse(result).status).toBe(403)
  })

  it("short-circuits with the parser's error shape", async () => {
    mockParse.mockReturnValue({ error: "bad" } as never)
    const result = await callAction(action, { formData: { intent: "create" } })
    expect(expectData<{ error?: string }>(result)).toEqual({ error: "bad" })
  })

  it("delegates to the mutation handler", async () => {
    mockParse.mockReturnValue({ intent: "create" } as never)
    mockHandle.mockReturnValue("effect" as never)
    mockRunEffect.mockResolvedValue({ success: true } as never)
    const result = await callAction(action, { formData: { intent: "create" } })
    expect(expectData<{ success?: boolean }>(result)).toEqual({ success: true })
  })
})
