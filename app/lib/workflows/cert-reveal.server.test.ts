// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest"
import { Effect } from "effect"
import { CertificateRepo } from "~/lib/services/CertificateRepo.server"
import { CertRevealRepo } from "~/lib/services/CertRevealRepo.server"
import { CertManager } from "~/lib/services/CertManager.server"
import { consumeReveal } from "./cert-reveal.server"
import { hashToken } from "~/lib/crypto.server"
import { testRunEffect, truncateAll } from "~/test/test-runtime"

/**
 * Seed a cert plus a reveal token for a freshly issued replacement, the state
 * the world is in between "user clicked Renew" and "user opened the email".
 */
const seedRenewal = (opts: { oldSerial: string | null; username?: string }) =>
  Effect.gen(function* () {
    const certRepo = yield* CertificateRepo
    const revealRepo = yield* CertRevealRepo
    const cert = yield* CertManager
    const username = opts.username ?? "alice"
    const email = `${username}@example.com`

    if (opts.oldSerial) {
      yield* certRepo.store({
        username,
        email,
        serialNumber: opts.oldSerial,
        issuedAt: new Date(Date.now() - 60 * 86_400_000),
        expiresAt: new Date(Date.now() + 5 * 86_400_000),
      })
    }

    // Mint a real p12 + password so the reveal resolves to "ok".
    const renewalId = `renewal-${opts.oldSerial ?? "new"}`
    yield* cert.issueCertAndP12(email, renewalId)
    const { token } = yield* revealRepo.create({
      renewalId,
      email,
      username,
      expiresAt: new Date(Date.now() + 86_400_000),
      renewedFromSerial: opts.oldSerial,
    })
    return token
  })

const readCert = (serialNumber: string) =>
  Effect.gen(function* () {
    const repo = yield* CertificateRepo
    return yield* repo.findBySerial(serialNumber)
  })

beforeEach(async () => {
  await truncateAll()
})

describe("consumeReveal", () => {
  it("revokes the superseded cert once the replacement is in the user's hands", async () => {
    const token = await testRunEffect(seedRenewal({ oldSerial: "SN-PREV" }))

    expect(await testRunEffect(consumeReveal(token))).toBe(true)

    const old = await testRunEffect(readCert("SN-PREV"))
    expect(old?.revokeState).toBe("completed")
    expect(old?.revokedAt).not.toBeNull()
  })

  it("leaves other certs alone when the issuance was not a renewal", async () => {
    await testRunEffect(
      Effect.gen(function* () {
        const repo = yield* CertificateRepo
        yield* repo.store({
          username: "alice",
          email: "alice@example.com",
          serialNumber: "SN-UNRELATED",
          issuedAt: new Date(),
          expiresAt: new Date(Date.now() + 90 * 86_400_000),
        })
      }),
    )
    const token = await testRunEffect(seedRenewal({ oldSerial: null }))

    expect(await testRunEffect(consumeReveal(token))).toBe(true)
    expect((await testRunEffect(readCert("SN-UNRELATED")))?.revokedAt).toBeNull()
  })

  it("stamps the reveal so the hand-over is auditable", async () => {
    const token = await testRunEffect(seedRenewal({ oldSerial: null }))
    await testRunEffect(consumeReveal(token))

    const row = await testRunEffect(
      Effect.gen(function* () {
        const repo = yield* CertRevealRepo
        return yield* repo.findByTokenHash(hashToken(token))
      }),
    )
    expect(row?.revealedAt).not.toBeNull()
  })

  it("reports nothing revealed for an unknown token", async () => {
    expect(await testRunEffect(consumeReveal("not-a-real-token"))).toBe(false)
  })

  it("still hands over the password when revoking the old cert fails", async () => {
    const token = await testRunEffect(seedRenewal({ oldSerial: "SN-STUCK" }))

    // Losing a revocation is recoverable; losing the password is not — it
    // exists nowhere else once consumed.
    const revealed = await testRunEffect(
      consumeReveal(token).pipe(
        Effect.provideService(CertManager, {
          getP12Password: () => Effect.succeed("hunter2"),
          getP12: () => Effect.succeed(Buffer.from("p12")),
          consumeP12Password: () => Effect.void,
          revokeCert: () => Effect.fail(new Error("vault down")),
        } as never),
      ),
    )

    expect(revealed).toBe(true)
    const old = await testRunEffect(readCert("SN-STUCK"))
    expect(old?.revokeState).toBe("failed")
    expect(old?.revokedAt).toBeNull()
  })
})
