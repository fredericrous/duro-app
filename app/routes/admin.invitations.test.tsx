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
import { action, loader } from "./admin.invitations"
import { callAction, callLoader, expectData, expectResponse } from "~/test/route-utils"

const mockRunEffect = vi.mocked(runEffect)
const mockOrigin = vi.mocked(isOriginAllowed)
const mockGetAuth = vi.mocked(getAuth)

beforeEach(() => {
  vi.clearAllMocks()
  mockOrigin.mockReturnValue(true)
  mockGetAuth.mockResolvedValue({ user: "admin", sub: "admin-sub" } as never)
})

describe("/admin/invitations loader", () => {
  it("returns invitations + applications + principals", async () => {
    // Order: applications, principals, then one runEffect per app.
    mockRunEffect
      .mockResolvedValueOnce([{ id: "app-1" }, { id: "app-2" }] as never)
      .mockResolvedValueOnce([{ id: "p-1" }] as never)
      .mockResolvedValueOnce([{ id: "inv-1" }] as never)
      .mockResolvedValueOnce([{ id: "inv-2" }] as never)

    const result = await callLoader(loader)
    const data = expectData<{ invitations: unknown[]; applications: unknown[]; principals: unknown[] }>(result)

    expect(data.applications).toHaveLength(2)
    expect(data.principals).toHaveLength(1)
    expect(data.invitations).toHaveLength(2)
  })
})

describe("/admin/invitations action", () => {
  it("throws 403 when origin is invalid", async () => {
    mockOrigin.mockReturnValue(false)
    const result = await callAction(action, { formData: { intent: "createInvitation" } })
    expect(expectResponse(result).status).toBe(403)
  })

  it("returns missing-fields error when app or principal is omitted", async () => {
    const result = await callAction(action, {
      formData: { intent: "createInvitation", applicationId: "", invitedPrincipalId: "" },
    })
    const data = expectData<{ error?: string }>(result)
    expect(data.error).toContain("required")
  })
})
