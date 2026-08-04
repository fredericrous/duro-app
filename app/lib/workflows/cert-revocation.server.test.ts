// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest"
import { Effect } from "effect"
import { CertificateRepo } from "~/lib/services/CertificateRepo.server"
import { CertManager } from "~/lib/services/CertManager.server"
import { revokeSupersededCert } from "./cert-revocation.server"
import { testRunEffect, truncateAll } from "~/test/test-runtime"

const seedCert = (serialNumber: string, username: string) =>
  Effect.gen(function* () {
    const repo = yield* CertificateRepo
    yield* repo.store({
      username,
      email: `${username}@example.com`,
      serialNumber,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 90 * 86_400_000),
    })
  })

const readCert = (serialNumber: string) =>
  Effect.gen(function* () {
    const repo = yield* CertificateRepo
    return yield* repo.findBySerial(serialNumber)
  })

beforeEach(async () => {
  await truncateAll()
})

describe("revokeSupersededCert", () => {
  it("revokes the cert a renewal replaced", async () => {
    await testRunEffect(seedCert("SN-SUP", "alice"))
    await testRunEffect(revokeSupersededCert("SN-SUP", "alice"))

    const cert = await testRunEffect(readCert("SN-SUP"))
    expect(cert?.revokeState).toBe("completed")
    expect(cert?.revokedAt).not.toBeNull()
  })

  it("is a no-op for a cert belonging to someone else", async () => {
    await testRunEffect(seedCert("SN-OTHER", "alice"))
    await testRunEffect(revokeSupersededCert("SN-OTHER", "mallory"))

    const cert = await testRunEffect(readCert("SN-OTHER"))
    expect(cert?.revokeState).toBeNull()
    expect(cert?.revokedAt).toBeNull()
  })

  it("is a no-op for an already-revoked cert", async () => {
    await testRunEffect(seedCert("SN-DONE", "alice"))
    await testRunEffect(revokeSupersededCert("SN-DONE", "alice"))
    const first = await testRunEffect(readCert("SN-DONE"))

    // A reveal link opened twice must not thrash the row.
    await testRunEffect(revokeSupersededCert("SN-DONE", "alice"))
    const second = await testRunEffect(readCert("SN-DONE"))
    expect(second?.revokedAt).toEqual(first?.revokedAt)
  })

  it("does not fail when the serial is unknown", async () => {
    // Dangling lineage (the row was purged) must be inert, not an error.
    await expect(testRunEffect(revokeSupersededCert("SN-GHOST", "alice"))).resolves.toBeUndefined()
  })

  it("records a CA failure instead of propagating it", async () => {
    await testRunEffect(seedCert("SN-FAIL", "alice"))

    // The reveal that triggers this must still hand over the password, so a
    // Vault outage can only ever leave a 'failed' row for the user to retry.
    // Overriding the service on the effect (rather than composing a layer)
    // keeps the same runtime — and therefore the same PGlite instance.
    await testRunEffect(
      revokeSupersededCert("SN-FAIL", "alice").pipe(
        Effect.provideService(CertManager, {
          revokeCert: () => Effect.fail(new Error("vault down")),
        } as never),
      ),
    )

    const cert = await testRunEffect(readCert("SN-FAIL"))
    expect(cert?.revokeState).toBe("failed")
    expect(cert?.revokeError).toContain("vault down")
    expect(cert?.revokedAt).toBeNull()
  })
})
