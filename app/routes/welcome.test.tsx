import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/auth.server", () => ({
  requireAuth: vi.fn(),
}))
vi.mock("~/lib/config.server", () => ({
  config: { appName: "Duro" },
}))

import { requireAuth } from "~/lib/auth.server"
import { loader, meta } from "./welcome"
import { callLoader, expectData } from "~/test/route-utils"

const mockRequireAuth = vi.mocked(requireAuth)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("/welcome loader", () => {
  it("returns user and appName", async () => {
    mockRequireAuth.mockResolvedValue({ user: "alice", email: "a@x", groups: [], sub: "s" } as never)
    const result = await callLoader(loader)
    const data = expectData<{ user: string; appName: string }>(result)
    expect(data).toEqual({ user: "alice", appName: "Duro" })
  })
})

describe("/welcome meta", () => {
  it("uses appName in the title when present", () => {
    const tags = meta({ data: { user: "alice", appName: "Duro" } } as never)
    expect(tags[0]).toEqual({ title: "Welcome - Duro" })
  })

  it("falls back to 'Welcome' when data is missing", () => {
    const tags = meta({ data: null } as never)
    expect(tags[0]).toEqual({ title: "Welcome" })
  })
})
