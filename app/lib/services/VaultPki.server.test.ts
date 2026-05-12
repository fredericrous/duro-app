// @vitest-environment node
//
// node-forge does Buffer/binary work in createP12. jsdom polyfills Buffer
// inconsistently, so issueCertAndP12 occasionally hits subtle PEM-parsing
// failures there. This is a server-only Effect Service — no DOM needed.
//
// Configure env BEFORE imports — VaultPkiLive reads NAS_VAULT_ADDR /
// NAS_VAULT_TOKEN at layer-build time via Effect.Config. Base URL must
// match VAULT_BASE in msw-server.ts so the central defaults answer.
process.env.NAS_VAULT_ADDR = "http://vault.test:8200"
process.env.NAS_VAULT_TOKEN = "test-vault-token"

import { describe, expect, it, vi, beforeAll } from "vitest"
import { Effect, Layer, ManagedRuntime } from "effect"
import { FetchHttpClient } from "@effect/platform"
import forge from "node-forge"
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

// ============================================================================
// issueCertAndP12 — Vault PKI sign + forge P12 bundle
// ============================================================================

/**
 * Build a real self-signed cert + key pair via node-forge so the test
 * exercises the same PEM-parsing path the prod code does. Computed once
 * via beforeAll because the keygen is expensive (~200ms).
 */
let realPem: { certificate: string; private_key: string }

beforeAll(() => {
  // Generate a 1024-bit RSA pair (smaller = faster; this is a test fixture).
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024 })
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = "01"
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
  const attrs = [
    { name: "commonName", value: "test@example.com" },
    { name: "organizationName", value: "Test" },
  ]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.sign(keys.privateKey, forge.md.sha256.create())
  realPem = {
    certificate: forge.pki.certificateToPem(cert),
    private_key: forge.pki.privateKeyToPem(keys.privateKey),
  }
})

describe("VaultPki — issueCertAndP12", () => {
  it("issues a fresh cert + writes the P12 secret when none exists", async () => {
    // No existing P12 → first GET 404, then issue cert, then POST secret.
    const writes: Array<{ url: string; body: unknown }> = []
    let issueCalls = 0
    server.use(
      http.get(`${VAULT_URL}/v1/secret/data/pki/clients/inv-fresh`, () =>
        HttpResponse.json({ errors: ["not found"] }, { status: 404 }),
      ),
      http.post(`${VAULT_URL}/v1/pki-client/issue/client-cert`, async ({ request }) => {
        issueCalls++
        const body = (await request.json()) as { common_name: string; ttl: string }
        expect(body.common_name).toBe("alice@example.com")
        expect(body.ttl).toBe("2160h")
        return HttpResponse.json({
          data: {
            certificate: realPem.certificate,
            private_key: realPem.private_key,
            ca_chain: [],
            serial_number: "AA:BB:CC:DD",
            not_after: "2027-01-01T00:00:00Z",
          },
        })
      }),
      http.post(`${VAULT_URL}/v1/secret/data/pki/clients/inv-fresh`, async ({ request }) => {
        writes.push({ url: request.url, body: await request.json() })
        return HttpResponse.json({})
      }),
    )

    const rt = makeRuntime()
    const out = await rt.runPromise(
      Effect.gen(function* () {
        const v = yield* VaultPki
        return yield* v.issueCertAndP12("alice@example.com", "inv-fresh")
      }),
    )

    expect(issueCalls).toBe(1)
    expect(out.serialNumber).toBe("AA:BB:CC:DD")
    expect(out.notAfter.toISOString()).toBe("2027-01-01T00:00:00.000Z")
    // base64 password from 24 random bytes → 32-char string.
    expect(out.password).toMatch(/^[A-Za-z0-9+/=]{32}$/)
    // The P12 buffer is real PKCS#12 binary — non-empty + parseable by forge.
    expect(out.p12Buffer.length).toBeGreaterThan(0)
    const p12Asn1 = forge.asn1.fromDer(out.p12Buffer.toString("binary"))
    expect(() => forge.pkcs12.pkcs12FromAsn1(p12Asn1, out.password)).not.toThrow()

    // The KV2 write happened with the right shape.
    expect(writes).toHaveLength(1)
    const wrote = writes[0].body as { data: Record<string, string> }
    expect(wrote.data.serial_number).toBe("AA:BB:CC:DD")
    expect(wrote.data.password).toBe(out.password)
    expect(wrote.data.email).toBe("alice@example.com")
    expect(wrote.data.p12).toBe(out.p12Buffer.toString("base64"))
    await rt.dispose()
  })

  it("short-circuits with the existing secret when one is already stored (idempotency)", async () => {
    // Pre-existing P12 → returns stored values, never hits the PKI issue endpoint.
    let issueCalls = 0
    server.use(
      http.get(`${VAULT_URL}/v1/secret/data/pki/clients/inv-cached`, () =>
        HttpResponse.json({
          data: {
            data: {
              p12: Buffer.from("cached-p12-bytes").toString("base64"),
              password: "stored-pw",
              email: "alice@example.com",
              serial_number: "11:22:33",
              not_after: "2030-06-01T00:00:00Z",
            },
          },
        }),
      ),
      http.post(`${VAULT_URL}/v1/pki-client/issue/client-cert`, () => {
        issueCalls++
        return HttpResponse.json({}, { status: 500 })
      }),
    )

    const rt = makeRuntime()
    const out = await rt.runPromise(
      Effect.gen(function* () {
        const v = yield* VaultPki
        return yield* v.issueCertAndP12("alice@example.com", "inv-cached")
      }),
    )

    expect(issueCalls).toBe(0) // never touched PKI
    expect(out.password).toBe("stored-pw")
    expect(out.serialNumber).toBe("11:22:33")
    expect(out.notAfter.toISOString()).toBe("2030-06-01T00:00:00.000Z")
    expect(out.p12Buffer.toString()).toBe("cached-p12-bytes")
    await rt.dispose()
  })

  it("fails with VaultPkiError when the PKI issue response is malformed", async () => {
    server.use(
      http.get(`${VAULT_URL}/v1/secret/data/pki/clients/inv-bad`, () =>
        HttpResponse.json({ errors: ["nf"] }, { status: 404 }),
      ),
      // Missing the `certificate` and `private_key` fields → Schema decode fails.
      http.post(`${VAULT_URL}/v1/pki-client/issue/client-cert`, () =>
        HttpResponse.json({ data: { serial_number: "x" } }),
      ),
    )

    const rt = makeRuntime()
    const result = await rt.runPromiseExit(
      Effect.gen(function* () {
        const v = yield* VaultPki
        return yield* v.issueCertAndP12("alice@example.com", "inv-bad")
      }),
    )
    expect(result._tag).toBe("Failure")
    await rt.dispose()
  })

  it("derives notAfter from the cert PEM when Vault didn't return one", async () => {
    server.use(
      http.get(`${VAULT_URL}/v1/secret/data/pki/clients/inv-noexp`, () =>
        HttpResponse.json({ errors: ["nf"] }, { status: 404 }),
      ),
      http.post(`${VAULT_URL}/v1/pki-client/issue/client-cert`, () =>
        HttpResponse.json({
          data: {
            certificate: realPem.certificate,
            private_key: realPem.private_key,
            ca_chain: [],
            serial_number: "ZZ:99",
            // not_after deliberately omitted — code falls back to forge.pki parsing.
          },
        }),
      ),
      http.post(`${VAULT_URL}/v1/secret/data/pki/clients/inv-noexp`, () => HttpResponse.json({})),
    )

    const rt = makeRuntime()
    const out = await rt.runPromise(
      Effect.gen(function* () {
        const v = yield* VaultPki
        return yield* v.issueCertAndP12("alice@example.com", "inv-noexp")
      }),
    )
    // The fixture cert is valid for ~365 days from beforeAll() time — so
    // notAfter must be a real future date.
    expect(out.notAfter.getTime()).toBeGreaterThan(Date.now())
    await rt.dispose()
  })
})
