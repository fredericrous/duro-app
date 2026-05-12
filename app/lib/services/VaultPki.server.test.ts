// Configure env BEFORE imports — VaultPkiLive reads NAS_VAULT_ADDR /
// NAS_VAULT_TOKEN at layer-build time via Effect.Config. Base URL must
// match VAULT_BASE in msw-server.ts so the central defaults answer.
process.env.NAS_VAULT_ADDR = "http://vault.test:8200"
process.env.NAS_VAULT_TOKEN = "test-vault-token"

import { describe, expect, it, vi } from "vitest"
import { Effect, Layer, ManagedRuntime } from "effect"
import { FetchHttpClient } from "@effect/platform"
import { http, HttpResponse, server, VAULT_BASE } from "~/test/msw-server"
import { VaultPki, VaultPkiLive } from "./VaultPki.server"

vi.setConfig({ testTimeout: 10000 })

const VAULT_URL = VAULT_BASE

function makeRuntime() {
  return ManagedRuntime.make(VaultPkiLive.pipe(Layer.provide(FetchHttpClient.layer)))
}

describe("VaultPki — getP12Password", () => {
  it("returns the stored password when the Vault secret exists", async () => {
    server.use(
      http.get(`${VAULT_URL}/v1/secret/data/pki/clients/invite-1`, () =>
        HttpResponse.json({
          data: { data: { p12: "base64", password: "secret-pw", email: "a@x" } },
        }),
      ),
    )

    const rt = makeRuntime()
    const pw = await rt.runPromise(
      Effect.gen(function* () {
        const v = yield* VaultPki
        return yield* v.getP12Password("invite-1")
      }),
    )
    expect(pw).toBe("secret-pw")
    await rt.dispose()
  })

  it("returns null when the Vault read fails (catchAll → null)", async () => {
    server.use(
      http.get(`${VAULT_URL}/v1/secret/data/pki/clients/missing`, () =>
        HttpResponse.json({ errors: ["not found"] }, { status: 404 }),
      ),
    )

    const rt = makeRuntime()
    const pw = await rt.runPromise(
      Effect.gen(function* () {
        const v = yield* VaultPki
        return yield* v.getP12Password("missing")
      }),
    )
    expect(pw).toBeNull()
    await rt.dispose()
  })
})

describe("VaultPki — consumeP12Password", () => {
  it("reads the password then writes back the secret WITHOUT the password (one-time reveal)", async () => {
    const writes: Array<unknown> = []
    server.use(
      http.get(`${VAULT_URL}/v1/secret/data/pki/clients/invite-2`, () =>
        HttpResponse.json({
          data: {
            data: { p12: "base64-data", password: "reveal-once", email: "a@x", serial_number: "abc" },
          },
        }),
      ),
      http.post(`${VAULT_URL}/v1/secret/data/pki/clients/invite-2`, async ({ request }) => {
        writes.push(await request.json())
        return HttpResponse.json({})
      }),
    )

    const rt = makeRuntime()
    const pw = await rt.runPromise(
      Effect.gen(function* () {
        const v = yield* VaultPki
        return yield* v.consumeP12Password("invite-2")
      }),
    )

    expect(pw).toBe("reveal-once")
    expect(writes).toHaveLength(1)
    const wrote = writes[0] as { data: Record<string, unknown> }
    // The write-back has every field EXCEPT password.
    expect(wrote.data.password).toBeUndefined()
    expect(wrote.data.p12).toBe("base64-data")
    expect(wrote.data.serial_number).toBe("abc")
    await rt.dispose()
  })

  it("returns null without writing when no password is stored", async () => {
    let writes = 0
    server.use(
      http.get(`${VAULT_URL}/v1/secret/data/pki/clients/invite-3`, () =>
        HttpResponse.json({ data: { data: { p12: "x" } } }),
      ),
      http.post(`${VAULT_URL}/v1/secret/data/pki/clients/invite-3`, () => {
        writes++
        return HttpResponse.json({})
      }),
    )

    const rt = makeRuntime()
    const pw = await rt.runPromise(
      Effect.gen(function* () {
        const v = yield* VaultPki
        return yield* v.consumeP12Password("invite-3")
      }),
    )
    expect(pw).toBeNull()
    expect(writes).toBe(0)
    await rt.dispose()
  })
})

describe("VaultPki — deleteP12Secret / deleteCertByUsername", () => {
  it("deleteP12Secret swallows failures (best-effort cleanup)", async () => {
    server.use(
      http.delete(`${VAULT_URL}/v1/secret/metadata/pki/clients/invite-4`, () =>
        HttpResponse.json({ errors: ["nope"] }, { status: 500 }),
      ),
    )

    const rt = makeRuntime()
    // No throw — the impl wraps in Effect.catchAll(() => Effect.void).
    await rt.runPromise(
      Effect.gen(function* () {
        const v = yield* VaultPki
        yield* v.deleteP12Secret("invite-4")
      }),
    )
    await rt.dispose()
  })

  it("deleteCertByUsername hits the right Vault path", async () => {
    let deleted = ""
    server.use(
      http.delete(`${VAULT_URL}/v1/secret/metadata/pki/clients/:user`, ({ params }) => {
        deleted = params.user as string
        return HttpResponse.json({})
      }),
    )

    const rt = makeRuntime()
    await rt.runPromise(
      Effect.gen(function* () {
        const v = yield* VaultPki
        yield* v.deleteCertByUsername("alice")
      }),
    )
    expect(deleted).toBe("alice")
    await rt.dispose()
  })
})

describe("VaultPki — checkCertProcessed", () => {
  it("returns true when source === 'p12-generator-controller'", async () => {
    server.use(
      http.get(`${VAULT_URL}/v1/secret/data/pki/clients/alice`, () =>
        HttpResponse.json({ data: { data: { source: "p12-generator-controller" } } }),
      ),
    )

    const rt = makeRuntime()
    const ok = await rt.runPromise(
      Effect.gen(function* () {
        const v = yield* VaultPki
        return yield* v.checkCertProcessed("alice")
      }),
    )
    expect(ok).toBe(true)
    await rt.dispose()
  })

  it("returns false when source is something else", async () => {
    server.use(
      http.get(`${VAULT_URL}/v1/secret/data/pki/clients/bob`, () =>
        HttpResponse.json({ data: { data: { source: "manual" } } }),
      ),
    )

    const rt = makeRuntime()
    const ok = await rt.runPromise(
      Effect.gen(function* () {
        const v = yield* VaultPki
        return yield* v.checkCertProcessed("bob")
      }),
    )
    expect(ok).toBe(false)
    await rt.dispose()
  })

  it("returns false when the Vault read fails entirely", async () => {
    server.use(
      http.get(`${VAULT_URL}/v1/secret/data/pki/clients/ghost`, () =>
        HttpResponse.json({ errors: ["nf"] }, { status: 404 }),
      ),
    )

    const rt = makeRuntime()
    const ok = await rt.runPromise(
      Effect.gen(function* () {
        const v = yield* VaultPki
        return yield* v.checkCertProcessed("ghost")
      }),
    )
    expect(ok).toBe(false)
    await rt.dispose()
  })
})

describe("VaultPki — revokeCert", () => {
  it("succeeds on a normal 200 from Vault", async () => {
    let revokedSerial = ""
    server.use(
      http.post(`${VAULT_URL}/v1/pki-client/revoke`, async ({ request }) => {
        const body = (await request.json()) as { serial_number: string }
        revokedSerial = body.serial_number
        return HttpResponse.json({ data: {} })
      }),
    )

    const rt = makeRuntime()
    await rt.runPromise(
      Effect.gen(function* () {
        const v = yield* VaultPki
        yield* v.revokeCert("AA:BB:CC")
      }),
    )
    expect(revokedSerial).toBe("AA:BB:CC")
    await rt.dispose()
  })

  it("treats 'already revoked' as idempotent success (no throw)", async () => {
    server.use(
      http.post(`${VAULT_URL}/v1/pki-client/revoke`, () =>
        HttpResponse.json({ errors: ["cert already revoked"] }, { status: 400 }),
      ),
    )

    const rt = makeRuntime()
    await rt.runPromise(
      Effect.gen(function* () {
        const v = yield* VaultPki
        yield* v.revokeCert("DD:EE:FF")
      }),
    )
    await rt.dispose()
  })

  it("treats 404 as idempotent success (no throw)", async () => {
    server.use(
      http.post(`${VAULT_URL}/v1/pki-client/revoke`, () =>
        HttpResponse.json({ errors: ["not found"] }, { status: 404 }),
      ),
    )

    const rt = makeRuntime()
    await rt.runPromise(
      Effect.gen(function* () {
        const v = yield* VaultPki
        yield* v.revokeCert("GG:HH:II")
      }),
    )
    await rt.dispose()
  })

  it("fails for other Vault error responses", async () => {
    server.use(
      http.post(`${VAULT_URL}/v1/pki-client/revoke`, () =>
        HttpResponse.json({ errors: ["permission denied"] }, { status: 403 }),
      ),
    )

    const rt = makeRuntime()
    const result = await rt.runPromiseExit(
      Effect.gen(function* () {
        const v = yield* VaultPki
        yield* v.revokeCert("XX")
      }),
    )
    expect(result._tag).toBe("Failure")
    await rt.dispose()
  })
})
