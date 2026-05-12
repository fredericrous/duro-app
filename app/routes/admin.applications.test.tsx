import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))
vi.mock("~/lib/config.server", () => ({
  isOriginAllowed: vi.fn().mockReturnValue(true),
}))
vi.mock("~/lib/mutations/admin-applications", () => ({
  parseAdminApplicationsMutation: vi.fn(),
  handleAdminApplicationsMutation: vi.fn(),
}))

import { runEffect } from "~/lib/runtime.server"
import { isOriginAllowed } from "~/lib/config.server"
import { parseAdminApplicationsMutation, handleAdminApplicationsMutation } from "~/lib/mutations/admin-applications"
import { action, loader } from "./admin.applications"
import { callAction, callLoader, expectData, expectResponse } from "~/test/route-utils"

const mockRunEffect = vi.mocked(runEffect)
const mockOrigin = vi.mocked(isOriginAllowed)
const mockParse = vi.mocked(parseAdminApplicationsMutation)
const mockHandle = vi.mocked(handleAdminApplicationsMutation)

beforeEach(() => {
  vi.clearAllMocks()
  mockOrigin.mockReturnValue(true)
})

describe("/admin/applications loader", () => {
  it("returns the application list via the repo", async () => {
    const apps = [{ id: "a1", slug: "jellyfin", displayName: "Jellyfin" }]
    mockRunEffect.mockResolvedValue(apps as never)

    const result = await callLoader(loader)
    const data = expectData<{ applications: unknown[] }>(result)
    expect(data.applications).toEqual(apps)
  })
})

describe("/admin/applications action", () => {
  it("throws 403 when origin is invalid", async () => {
    mockOrigin.mockReturnValue(false)

    const result = await callAction(action, { formData: { intent: "create" } })
    const res = expectResponse(result)
    expect(res.status).toBe(403)
  })

  it("returns the parser's error short-circuit", async () => {
    mockParse.mockReturnValue({ error: "missing_slug" } as never)

    const result = await callAction(action, { formData: { intent: "create" } })
    const data = expectData<{ error?: string }>(result)
    expect(data).toEqual({ error: "missing_slug" })
    expect(mockHandle).not.toHaveBeenCalled()
  })

  it("delegates valid input to the mutation handler", async () => {
    mockParse.mockReturnValue({ intent: "create", slug: "x", displayName: "X" } as never)
    mockHandle.mockReturnValue("effect" as never)
    mockRunEffect.mockResolvedValue({ success: true, applicationId: "app-1" } as never)

    const result = await callAction(action, { formData: { intent: "create", slug: "x", displayName: "X" } })
    const data = expectData<{ success?: boolean; applicationId?: string }>(result)
    expect(data).toEqual({ success: true, applicationId: "app-1" })
  })
})
