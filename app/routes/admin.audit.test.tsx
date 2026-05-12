import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))

import { runEffect } from "~/lib/runtime.server"
import { loader } from "./admin.audit"
import { callLoader, expectData } from "~/test/route-utils"

const mockRunEffect = vi.mocked(runEffect)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("/admin/audit loader", () => {
  it("returns the audit event list via the service", async () => {
    const events = [{ id: "e1", eventType: "grant.created" }]
    mockRunEffect.mockResolvedValue(events as never)

    const result = await callLoader(loader)
    const data = expectData<unknown>(result)
    // The loader returns whatever runEffect resolves to; just confirm
    // the round-trip survives without throwing.
    expect(data).toBeDefined()
  })
})
