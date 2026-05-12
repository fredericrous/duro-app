import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))
vi.mock("~/lib/config.server", () => ({
  isOriginAllowed: vi.fn().mockReturnValue(true),
}))

import { runEffect } from "~/lib/runtime.server"
import { isOriginAllowed } from "~/lib/config.server"
import { action, loader } from "./admin.authz-playground"
import { callAction, callLoader, expectData, expectResponse } from "~/test/route-utils"

const mockRunEffect = vi.mocked(runEffect)
const mockOrigin = vi.mocked(isOriginAllowed)

beforeEach(() => {
  vi.clearAllMocks()
  mockOrigin.mockReturnValue(true)
})

describe("/admin/authz-playground loader", () => {
  it("returns the loader data", async () => {
    mockRunEffect.mockResolvedValue([] as never)
    const result = await callLoader(loader)
    expect(expectData<unknown>(result)).toBeDefined()
  })
})

describe("/admin/authz-playground action", () => {
  it("throws 403 when origin is invalid", async () => {
    mockOrigin.mockReturnValue(false)
    const result = await callAction(action, { formData: { intent: "checkAccess" } })
    expect(expectResponse(result).status).toBe(403)
  })
})
