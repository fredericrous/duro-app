import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))

import { runEffect } from "~/lib/runtime.server"
import { loader } from "./admin.plugins"
import { callLoader, expectData } from "~/test/route-utils"

const mockRunEffect = vi.mocked(runEffect)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("/admin/plugins loader", () => {
  it("returns plugin manifests with installation counts", async () => {
    const data = [
      { slug: "gitea-teams", installations: 2 },
      { slug: "plex-libs", installations: 0 },
    ]
    mockRunEffect.mockResolvedValue(data as never)

    const result = await callLoader(loader)
    const loaded = expectData<{ plugins: unknown[] }>(result)
    expect(loaded.plugins).toEqual(data)
  })
})
