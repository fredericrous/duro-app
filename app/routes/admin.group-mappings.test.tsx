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

import { runEffect } from "~/lib/runtime.server"
import { isOriginAllowed } from "~/lib/config.server"
import { getAuth } from "~/lib/auth.server"
import { action, loader } from "./admin.group-mappings"
import { callAction, callLoader, expectData, expectResponse } from "~/test/route-utils"

const mockRunEffect = vi.mocked(runEffect)
const mockOrigin = vi.mocked(isOriginAllowed)
const mockGetAuth = vi.mocked(getAuth)

beforeEach(() => {
  vi.clearAllMocks()
  mockOrigin.mockReturnValue(true)
  mockGetAuth.mockResolvedValue({ user: "admin", sub: "admin-sub" } as never)
})

describe("/admin/group-mappings loader", () => {
  it("returns loader data without throwing", async () => {
    mockRunEffect.mockResolvedValue([] as never)
    const result = await callLoader(loader)
    const data = expectData<unknown>(result)
    expect(data).toBeDefined()
  })
})

describe("/admin/group-mappings action", () => {
  it("throws 403 when origin is invalid", async () => {
    mockOrigin.mockReturnValue(false)
    const result = await callAction(action, { formData: { intent: "create" } })
    expect(expectResponse(result).status).toBe(403)
  })

  it("requires oidcGroupName to create", async () => {
    const result = await callAction(action, {
      formData: { intent: "create", oidcGroupName: "  ", mappingType: "group" },
    })
    const data = expectData<{ error?: string }>(result)
    expect(data.error).toContain("OIDC group name")
  })

  it("requires principalGroupId for mappingType=group", async () => {
    const result = await callAction(action, {
      formData: { intent: "create", oidcGroupName: "okta", mappingType: "group", principalGroupId: "" },
    })
    const data = expectData<{ error?: string }>(result)
    expect(data.error).toContain("Principal group")
  })

  it("requires app+role for mappingType=role", async () => {
    const result = await callAction(action, {
      formData: { intent: "create", oidcGroupName: "okta", mappingType: "role", roleId: "" },
    })
    const data = expectData<{ error?: string }>(result)
    expect(data.error).toContain("Application and role")
  })
})
