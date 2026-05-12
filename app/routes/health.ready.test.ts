import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))

import { runEffect } from "~/lib/runtime.server"
import { loader } from "./health.ready"

const mockRunEffect = vi.mocked(runEffect)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /health/ready", () => {
  it("returns 200 status=ready when the DB ping succeeds", async () => {
    mockRunEffect.mockResolvedValue(undefined as never)
    const res = await loader()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: "ready" })
  })

  it("returns 503 status=not_ready when the DB ping fails", async () => {
    mockRunEffect.mockRejectedValue(new Error("PgClient: Failed to connect"))
    const res = await loader()
    expect(res.status).toBe(503)
    const body = (await res.json()) as { status: string; error: string }
    expect(body.status).toBe("not_ready")
    expect(body.error).toContain("PgClient: Failed to connect")
  })
})
