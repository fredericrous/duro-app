import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("~/lib/auth.server", () => ({ getAuth: vi.fn() }))
vi.mock("~/lib/auth-decision.server", () => ({ checkAuthDecision: vi.fn() }))
vi.mock("~/lib/config.server", () => ({ isOriginAllowed: vi.fn() }))

import { getAuth } from "~/lib/auth.server"
import { checkAuthDecision } from "~/lib/auth-decision.server"
import { isOriginAllowed } from "~/lib/config.server"
import { requireAdmin, requireAdminAction } from "./admin-guard.server"

const mockGetAuth = vi.mocked(getAuth)
const mockCheckDecision = vi.mocked(checkAuthDecision)
const mockOrigin = vi.mocked(isOriginAllowed)

const ADMIN = { sub: "s", user: "admin", email: "a@b.c", groups: ["lldap_admin"] }

beforeEach(() => {
  vi.clearAllMocks()
  mockGetAuth.mockResolvedValue(ADMIN as never)
  mockOrigin.mockReturnValue(true)
})

async function asResponse(fn: () => Promise<unknown>): Promise<Response> {
  try {
    await fn()
    throw new Error("expected a thrown Response")
  } catch (e) {
    if (e instanceof Response) return e
    throw e
  }
}

describe("requireAdmin", () => {
  it("returns auth when the decision allows", async () => {
    mockCheckDecision.mockResolvedValue({ allow: true } as never)
    const auth = await requireAdmin(new Request("http://localhost/admin/users"))
    expect(auth).toEqual(ADMIN)
    expect(mockCheckDecision).toHaveBeenCalledWith(expect.objectContaining({ application: "duro", action: "admin" }))
  })

  it("throws 403 when the decision denies (e.g. non-admin via single-fetch _routes)", async () => {
    mockCheckDecision.mockResolvedValue({ allow: false } as never)
    const res = await asResponse(() => requireAdmin(new Request("http://localhost/admin/recovery.data?_routes=x")))
    expect(res.status).toBe(403)
  })
})

describe("requireAdminAction", () => {
  it("allows an admin request with a valid Origin", async () => {
    mockCheckDecision.mockResolvedValue({ allow: true } as never)
    const req = new Request("http://localhost/admin/users", {
      method: "POST",
      headers: { Origin: "https://duro.example" },
    })
    await expect(requireAdminAction(req)).resolves.toEqual(ADMIN)
  })

  it("throws 403 when the Origin header is missing (a missing Origin on a mutation is deny)", async () => {
    mockCheckDecision.mockResolvedValue({ allow: true } as never)
    const req = new Request("http://localhost/admin/users", { method: "POST" })
    const res = await asResponse(() => requireAdminAction(req))
    expect(res.status).toBe(403)
    expect(mockOrigin).not.toHaveBeenCalled()
  })

  it("throws 403 when the Origin is cross-site", async () => {
    mockCheckDecision.mockResolvedValue({ allow: true } as never)
    mockOrigin.mockReturnValue(false)
    const req = new Request("http://localhost/admin/users", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    })
    const res = await asResponse(() => requireAdminAction(req))
    expect(res.status).toBe(403)
  })

  it("throws 403 (admin check first) when the caller is not an admin", async () => {
    mockCheckDecision.mockResolvedValue({ allow: false } as never)
    const req = new Request("http://localhost/admin/users", {
      method: "POST",
      headers: { Origin: "https://duro.example" },
    })
    const res = await asResponse(() => requireAdminAction(req))
    expect(res.status).toBe(403)
  })
})
