// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("./session.server", () => ({
  getSession: vi.fn(),
}))
vi.mock("./runtime.server", () => ({
  runEffect: vi.fn(),
}))

import { getSession } from "./session.server"
import { runEffect } from "./runtime.server"
import { requireApiAuth, requireScope } from "./api-auth.server"

const mockGetSession = vi.mocked(getSession)
const mockRunEffect = vi.mocked(runEffect)

beforeEach(() => {
  vi.clearAllMocks()
})

const req = (headers: Record<string, string> = {}) => new Request("http://localhost/api/x", { headers })

describe("requireApiAuth", () => {
  it("returns a session-source result when the session resolves to a known principal (keyed on sub, not name)", async () => {
    // sub and name deliberately differ — principals are keyed on the OIDC
    // subject, so the display name must NOT be what drives the lookup.
    mockGetSession.mockResolvedValue({ sub: "alice-sub", name: "Alice Display", email: "a@x", groups: [] } as never)
    mockRunEffect.mockResolvedValueOnce({ id: "p-alice" } as never)

    const result = await requireApiAuth(req())
    expect(result).toEqual({ principalId: "p-alice", scopes: ["*"], source: "session" })
  })

  it("falls through when the session principal can't be found", async () => {
    mockGetSession.mockResolvedValue({ sub: "ghost", name: "Ghost", email: "", groups: [] } as never)
    mockRunEffect.mockResolvedValueOnce(null as never) // principal lookup miss

    await expect(requireApiAuth(req())).rejects.toBeInstanceOf(Response)
  })

  it("authenticates via Authorization: Bearer duro_<key> when no session exists", async () => {
    mockGetSession.mockResolvedValue(null)
    mockRunEffect.mockResolvedValueOnce({ principalId: "p-bot", scopes: ["read:invites"] } as never)

    const result = await requireApiAuth(req({ Authorization: "Bearer duro_abcdef" }))
    expect(result).toEqual({ principalId: "p-bot", scopes: ["read:invites"], source: "api_key" })
  })

  it("rejects an Authorization header without the duro_ prefix", async () => {
    mockGetSession.mockResolvedValue(null)

    await expect(requireApiAuth(req({ Authorization: "Bearer something-else" }))).rejects.toBeInstanceOf(Response)
  })

  it("rejects an invalid API key (verify returned null)", async () => {
    mockGetSession.mockResolvedValue(null)
    mockRunEffect.mockResolvedValueOnce(null as never)

    await expect(requireApiAuth(req({ Authorization: "Bearer duro_bad" }))).rejects.toBeInstanceOf(Response)
  })

  it("returns a 401 Response when neither session nor API key is present", async () => {
    mockGetSession.mockResolvedValue(null)

    const result = await requireApiAuth(req()).catch((e) => e)
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(401)
  })
})

describe("requireScope", () => {
  it("allows when scopes include '*'", () => {
    expect(() => requireScope({ principalId: "p", scopes: ["*"], source: "session" }, "write:apps")).not.toThrow()
  })

  it("allows when the required scope is present explicitly", () => {
    expect(() =>
      requireScope({ principalId: "p", scopes: ["read:invites"], source: "api_key" }, "read:invites"),
    ).not.toThrow()
  })

  it("throws 403 when the scope is missing", () => {
    const err = (() => {
      try {
        requireScope({ principalId: "p", scopes: ["read:invites"], source: "api_key" }, "write:apps")
        return null
      } catch (e) {
        return e
      }
    })()
    expect(err).toBeInstanceOf(Response)
    expect((err as Response).status).toBe(403)
  })
})
