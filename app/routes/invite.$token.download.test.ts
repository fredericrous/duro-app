// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest"
import { Effect } from "effect"

vi.mock("~/lib/runtime.server", () => ({ runEffect: vi.fn() }))
vi.mock("~/lib/crypto.server", () => ({ hashToken: vi.fn().mockReturnValue("hashed-token") }))

import { runEffect } from "~/lib/runtime.server"
import { InviteRepo, InviteError } from "~/lib/services/InviteRepo.server"
import { CertManager } from "~/lib/services/CertManager.server"
import { loader } from "./invite.$token.download"
import { callLoader, expectData, expectResponse } from "~/test/route-utils"

const mockRunEffect = vi.mocked(runEffect)

describe("invite/:token/download loader", () => {
  beforeEach(() => vi.clearAllMocks())

  it("streams the P12 with attachment headers for a valid, unconsumed token", async () => {
    mockRunEffect.mockResolvedValue(Buffer.from("p12-bytes") as never)
    const res = expectData<Response>(await callLoader(loader, { params: { token: "tok" } }))
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("application/x-pkcs12")
    expect(res.headers.get("Content-Disposition")).toContain('filename="certificate.p12"')
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    const body = Buffer.from(await res.arrayBuffer())
    expect(body.toString()).toBe("p12-bytes")
  })

  it("404s when the cert is unavailable (used / expired / invalid invite)", async () => {
    mockRunEffect.mockResolvedValue(null as never)
    const res = expectResponse(await callLoader(loader, { params: { token: "tok" } }))
    expect(res.status).toBe(404)
  })

  it("404s when the token param is missing", async () => {
    const res = expectResponse(await callLoader(loader, { params: {} }))
    expect(res.status).toBe(404)
  })

  it("404s (not 500) when the underlying effect fails", async () => {
    // Typed failures are caught INSIDE the effect (catchAll → logError → null).
    // Run the real composed effect via a passthrough, with the repo failing,
    // so the in-effect fallback actually executes.
    mockRunEffect.mockImplementationOnce(
      (eff) =>
        Effect.runPromise(
          (eff as Effect.Effect<unknown, never, InviteRepo | CertManager>).pipe(
            Effect.provideService(InviteRepo, {
              findByTokenHash: () => Effect.fail(new InviteError({ message: "vault down" })),
            } as never),
            Effect.provideService(CertManager, {} as never),
          ),
        ) as never,
    )
    const res = expectResponse(await callLoader(loader, { params: { token: "tok" } }))
    expect(res.status).toBe(404)
  })
})
