import { describe, expect, it } from "vitest"
import { Effect, ManagedRuntime } from "effect"
import { CertManager, CertManagerDev } from "./CertManager.server"

describe("CertManager (Dev) — in-memory store", () => {
  const rt = ManagedRuntime.make(CertManagerDev)

  it("issueCertAndP12 returns a fake P12 + password + serial, persisted in the store", async () => {
    const result = await rt.runPromise(
      Effect.gen(function* () {
        const c = yield* CertManager
        return yield* c.issueCertAndP12("alice@example.com", "invite-1")
      }),
    )

    expect(result.p12Buffer).toBeInstanceOf(Buffer)
    expect(result.password.length).toBeGreaterThan(0)
    expect(result.serialNumber).toMatch(/^([0-9a-f]{2}:){7}[0-9a-f]{2}$/)
    expect(result.notAfter).toBeInstanceOf(Date)
  })

  it("getP12Password returns the previously-stored password for the same inviteId", async () => {
    const issued = await rt.runPromise(
      Effect.gen(function* () {
        const c = yield* CertManager
        return yield* c.issueCertAndP12("bob@example.com", "invite-2")
      }),
    )
    const pw = await rt.runPromise(
      Effect.gen(function* () {
        const c = yield* CertManager
        return yield* c.getP12Password("invite-2")
      }),
    )
    expect(pw).toBe(issued.password)
  })

  it("getP12Password returns null for an unknown inviteId", async () => {
    const pw = await rt.runPromise(
      Effect.gen(function* () {
        const c = yield* CertManager
        return yield* c.getP12Password("never-issued")
      }),
    )
    expect(pw).toBeNull()
  })

  it("consumeP12Password returns the password (Dev does not actually consume)", async () => {
    const issued = await rt.runPromise(
      Effect.gen(function* () {
        const c = yield* CertManager
        return yield* c.issueCertAndP12("carol@example.com", "invite-3")
      }),
    )
    const pw = await rt.runPromise(
      Effect.gen(function* () {
        const c = yield* CertManager
        return yield* c.consumeP12Password("invite-3")
      }),
    )
    expect(pw).toBe(issued.password)
  })

  it("deleteP12Secret removes the cert from the in-memory store", async () => {
    await rt.runPromise(
      Effect.gen(function* () {
        const c = yield* CertManager
        yield* c.issueCertAndP12("dave@example.com", "invite-4")
        yield* c.deleteP12Secret("invite-4")
      }),
    )
    const pw = await rt.runPromise(
      Effect.gen(function* () {
        const c = yield* CertManager
        return yield* c.getP12Password("invite-4")
      }),
    )
    expect(pw).toBeNull()
  })

  it("checkCertProcessed always returns true in dev (no Vault to check)", async () => {
    const ok = await rt.runPromise(
      Effect.gen(function* () {
        const c = yield* CertManager
        return yield* c.checkCertProcessed("any-user")
      }),
    )
    expect(ok).toBe(true)
  })

  it("deleteCertByUsername and revokeCert resolve without throwing", async () => {
    await rt.runPromise(
      Effect.gen(function* () {
        const c = yield* CertManager
        yield* c.deleteCertByUsername("alice")
        yield* c.revokeCert("AA:BB:CC")
      }),
    )
    // No assertion needed — surviving the runPromise is the assertion.
  })
})
