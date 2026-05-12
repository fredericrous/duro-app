import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))

import { runEffect } from "~/lib/runtime.server"
import { loader } from "./admin.principals"
import { callLoader, expectData } from "~/test/route-utils"

const mockRunEffect = vi.mocked(runEffect)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("/admin/principals loader", () => {
  it("returns the principal list via the repo", async () => {
    const principals = [
      { id: "p1", principalType: "user", displayName: "Alice" },
      { id: "p2", principalType: "group", displayName: "Admins" },
    ]
    mockRunEffect.mockResolvedValue(principals as never)

    const result = await callLoader(loader)
    const data = expectData<{ principals: unknown[] }>(result)
    expect(data.principals).toEqual(principals)
  })
})
