import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))

import { runEffect } from "~/lib/runtime.server"
import { loader } from "./admin.access-requests"
import { callLoader, expectData } from "~/test/route-utils"

const mockRunEffect = vi.mocked(runEffect)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("/admin/access-requests loader", () => {
  it("returns the enriched list from AccessRequestRepo", async () => {
    const requests = [{ id: "r1", status: "pending", applicationName: "App" }]
    mockRunEffect.mockResolvedValue(requests as never)

    const result = await callLoader(loader)
    const data = expectData<{ requests: unknown[] }>(result)
    expect(data.requests).toEqual(requests)
  })

  it("propagates an empty list", async () => {
    mockRunEffect.mockResolvedValue([] as never)
    const result = await callLoader(loader)
    const data = expectData<{ requests: unknown[] }>(result)
    expect(data.requests).toEqual([])
  })
})
