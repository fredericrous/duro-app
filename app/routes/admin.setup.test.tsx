import { describe, expect, it, vi, beforeEach } from "vitest"

// We mock isFirstRun directly because the loader's reliance on `runEffect`
// would otherwise pull in the full AppLayer (including LLDAP). The bootstrap
// workflow itself is covered end-to-end in
// app/lib/workflows/bootstrap.server.test.ts.
vi.mock("~/lib/governance/bootstrap.server", () => ({
  isFirstRun: { _tag: "Effect.Sync", _firstRun: false },
}))
vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(async (e: any) => {
    return e?._firstRun ?? false
  }),
}))

import { loader, action } from "./admin.setup"
import * as runtime from "~/lib/runtime.server"

beforeEach(() => {
  vi.mocked(runtime.runEffect).mockImplementation(async (e: any) => e?._firstRun ?? false)
})

// React Router 7 generates loader/action arg types that include
// `unstable_pattern` and other harness fields. In tests we hand them a
// minimal envelope and cast through `unknown` so the type system trusts us.
const callLoader = (req: Request) =>
  (loader as unknown as (args: { request: Request; params: object; context: object }) => Promise<unknown>)({
    request: req,
    params: {},
    context: {},
  })

const callAction = (req: Request) =>
  (action as unknown as (args: { request: Request; params: object; context: object }) => Promise<unknown>)({
    request: req,
    params: {},
    context: {},
  })

describe("admin.setup loader", () => {
  it("redirects to /admin when isFirstRun is false", async () => {
    let thrown: unknown
    try {
      await callLoader(new Request("http://localhost/admin/setup"))
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(Response)
    const resp = thrown as Response
    expect(resp.status).toBeGreaterThanOrEqual(300)
    expect(resp.status).toBeLessThan(400)
    expect(resp.headers.get("Location")).toBe("/admin")
  })

  it("returns loader data when isFirstRun is true", async () => {
    vi.mocked(runtime.runEffect).mockResolvedValueOnce(true)
    const data = (await callLoader(new Request("http://localhost/admin/setup"))) as {
      appName: string
      inviteBaseUrl: string
    }
    expect(data).toMatchObject({ appName: expect.any(String), inviteBaseUrl: expect.any(String) })
  })
})

describe("admin.setup action", () => {
  it("rejects requests with a disallowed Origin header", async () => {
    const formData = new FormData()
    formData.set("intent", "createBootstrapInvite")
    formData.set("email", "alice@example.com")

    const request = new Request("http://localhost/admin/setup", {
      method: "POST",
      headers: { Origin: "http://attacker.example.com" },
      body: formData,
    })

    const result = await callAction(request)
    expect(result).toEqual({ ok: false, error: "wrong_origin" })
  })

  it("rejects when isFirstRun is false (post-bootstrap action lockout)", async () => {
    // Origin allowed, but the action's first-run re-check redirects.
    vi.mocked(runtime.runEffect).mockResolvedValueOnce(false)

    const formData = new FormData()
    formData.set("intent", "createBootstrapInvite")
    formData.set("email", "alice@example.com")

    const request = new Request("http://daddyshome.fr/admin/setup", {
      method: "POST",
      headers: { Origin: "http://daddyshome.fr" },
      body: formData,
    })

    let thrown: unknown
    try {
      await callAction(request)
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(Response)
    expect((thrown as Response).headers.get("Location")).toBe("/admin")
  })
})
