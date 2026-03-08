// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

// Set VAULT_ADDR before module import (captured at load time)
process.env.VAULT_ADDR = "http://vault.test:8200"

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue("fake-sa-token"),
}))

vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))

const { action } = await import("./api.bootstrap-invite")
const { runEffect } = await import("~/lib/runtime.server")
const fs = await import("node:fs/promises")

const mockRunEffect = vi.mocked(runEffect)
const mockReadFile = vi.mocked(fs.readFile)

function makeRequest(method: string, body?: unknown): Request {
  return new Request("http://localhost/api/bootstrap-invite", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
}

function makeActionArgs(request: Request) {
  return { request, params: {}, context: {} } as Parameters<typeof action>[0]
}

const VALID_TOKEN = "test-bootstrap-token"

function mockVaultFetch(overrides?: { tokenData?: Record<string, unknown>; loginFail?: boolean }) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, _init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : ((input as { url?: string }).url ?? "")

    if (url.includes("/auth/kubernetes/login")) {
      if (overrides?.loginFail) {
        return new Response("forbidden", { status: 403 })
      }
      return Response.json({ auth: { client_token: "vault-client-token" } })
    }
    if (url.includes("/secret/data/duro/bootstrap-token")) {
      const tokenData = overrides?.tokenData ?? {
        token: VALID_TOKEN,
        expires_at: String(Date.now() + 60_000),
      }
      return Response.json({ data: { data: tokenData } })
    }
    if (url.includes("/secret/metadata/duro/bootstrap-token")) {
      return new Response(null, { status: 204 })
    }
    return new Response("not found", { status: 404 })
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
  mockReadFile.mockResolvedValue("fake-sa-token")
})

describe("POST /api/bootstrap-invite", () => {
  it("rejects non-POST methods", async () => {
    const req = new Request("http://localhost/api/bootstrap-invite", { method: "GET" })
    const resp = await action(makeActionArgs(req))
    expect(resp.status).toBe(405)
  })

  it("returns 400 when token is missing", async () => {
    mockVaultFetch()
    const resp = await action(makeActionArgs(makeRequest("POST", { email: "a@b.com" })))
    expect(resp.status).toBe(400)
    const body = await resp.json()
    expect(body.error).toContain("token")
  })

  it("returns 400 when email is missing", async () => {
    mockVaultFetch()
    const resp = await action(makeActionArgs(makeRequest("POST", { token: "tok" })))
    expect(resp.status).toBe(400)
    const body = await resp.json()
    expect(body.error).toContain("email")
  })

  it("returns 500 when Vault login fails", async () => {
    mockVaultFetch({ loginFail: true })
    const resp = await action(makeActionArgs(makeRequest("POST", { token: VALID_TOKEN, email: "a@b.com" })))
    expect(resp.status).toBe(500)
    const body = await resp.json()
    expect(body.error).toContain("Vault login failed")
  })

  it("returns 401 when bootstrap token is invalid", async () => {
    mockVaultFetch()
    const resp = await action(makeActionArgs(makeRequest("POST", { token: "wrong-token", email: "a@b.com" })))
    expect(resp.status).toBe(401)
    const body = await resp.json()
    expect(body.error).toContain("Invalid token")
  })

  it("returns 401 when bootstrap token is expired", async () => {
    mockVaultFetch({ tokenData: { token: VALID_TOKEN, expires_at: String(Date.now() - 60_000) } })
    const resp = await action(makeActionArgs(makeRequest("POST", { token: VALID_TOKEN, email: "a@b.com" })))
    expect(resp.status).toBe(401)
    const body = await resp.json()
    expect(body.error).toContain("expired")
  })

  it("always deletes the bootstrap token from Vault", async () => {
    const fetchSpy = mockVaultFetch()
    // Use wrong token so validation fails, but token should still be deleted
    await action(makeActionArgs(makeRequest("POST", { token: "wrong", email: "a@b.com" })))

    const deleteCalls = fetchSpy.mock.calls.filter(([input, init]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : ""
      return url.includes("/secret/metadata/duro/bootstrap-token") && (init as RequestInit)?.method === "DELETE"
    })
    expect(deleteCalls.length).toBe(1)
  })

  it("sends invite on valid token and returns success", async () => {
    mockVaultFetch()
    mockRunEffect.mockResolvedValue({ success: true, message: "Invite sent to admin@example.com" })

    const resp = await action(makeActionArgs(makeRequest("POST", { token: VALID_TOKEN, email: "admin@example.com" })))
    expect(resp.status).toBe(200)
    const body = await resp.json()
    expect(body.success).toBe(true)
    expect(body.message).toContain("admin@example.com")
    expect(mockRunEffect).toHaveBeenCalledTimes(1)
  })

  it("returns 500 when invite workflow fails", async () => {
    mockVaultFetch()
    mockRunEffect.mockRejectedValue(new Error("LLDAP unreachable"))

    const resp = await action(makeActionArgs(makeRequest("POST", { token: VALID_TOKEN, email: "admin@example.com" })))
    expect(resp.status).toBe(500)
    const body = await resp.json()
    expect(body.error).toContain("LLDAP unreachable")
  })
})
