// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest"
import { Effect } from "effect"
import { CertificateRepo } from "~/lib/services/CertificateRepo.server"
import { CertRevealRepo } from "~/lib/services/CertRevealRepo.server"
import { CertManager } from "~/lib/services/CertManager.server"
import { consumeReveal, nameDeviceFromReveal } from "./cert-reveal.server"
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

// ---------------------------------------------------------------------------
// Claim-time device naming (the QR flow's second half)
// ---------------------------------------------------------------------------

/** Seed a NEW-device reveal (no predecessor) whose row carries the serial. */
const seedNamedable = (opts: { serial?: string | null; username?: string } = {}) =>
  Effect.gen(function* () {
    const certRepo = yield* CertificateRepo
    const revealRepo = yield* CertRevealRepo
    const cert = yield* CertManager
    const username = opts.username ?? "alice"
    const email = `${username}@example.com`
    const serial = opts.serial === undefined ? "SN-QR-1" : opts.serial

    if (serial) {
      yield* certRepo.store({
        username,
        email,
        serialNumber: serial,
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 365 * 86_400_000),
      })
    }
    const renewalId = `renewal-qr-${serial ?? "none"}`
    yield* cert.issueCertAndP12(email, renewalId)
    const { token } = yield* revealRepo.create({
      renewalId,
      email,
      username,
      expiresAt: new Date(Date.now() + 86_400_000),
      serialNumber: serial,
    })
    return { token, serial }
  })

describe("nameDeviceFromReveal", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  it("names the cert while the token is live, trimming and capping the label", async () => {
    const { token, serial } = await testRunEffect(seedNamedable() as Effect.Effect<any, unknown, never>)
    const result = await testRunEffect(
      nameDeviceFromReveal(token, `  Pixel 9  ${"x".repeat(100)}`) as Effect.Effect<any, unknown, never>,
    )
    expect(result.named).toBe(true)
    expect(result.label.length).toBeLessThanOrEqual(64)
    const cert = await testRunEffect(readCert(serial!) as Effect.Effect<any, unknown, never>)
    expect(cert!.label).toBe(result.label)
  })

  it("still names after the password was revealed (natural setup order)", async () => {
    const { token, serial } = await testRunEffect(seedNamedable() as Effect.Effect<any, unknown, never>)
    await testRunEffect(consumeReveal(token) as Effect.Effect<unknown, unknown, never>)
    const result = await testRunEffect(nameDeviceFromReveal(token, "Pixel 9") as Effect.Effect<any, unknown, never>)
    expect(result).toMatchObject({ named: true, label: "Pixel 9" })
    const cert = await testRunEffect(readCert(serial!) as Effect.Effect<any, unknown, never>)
    expect(cert!.label).toBe("Pixel 9")
  })

  it("refuses an invalid token and an empty label", async () => {
    expect(
      await testRunEffect(nameDeviceFromReveal("nope", "Pixel") as Effect.Effect<any, unknown, never>),
    ).toMatchObject({ named: false, reason: "invalid" })
    const { token } = await testRunEffect(seedNamedable() as Effect.Effect<any, unknown, never>)
    expect(await testRunEffect(nameDeviceFromReveal(token, "   ") as Effect.Effect<any, unknown, never>)).toMatchObject(
      { named: false, reason: "empty" },
    )
  })

  it("refuses rows minted before the serial column (unnameable, not a crash)", async () => {
    const { token } = await testRunEffect(seedNamedable({ serial: null }) as Effect.Effect<any, unknown, never>)
    expect(
      await testRunEffect(nameDeviceFromReveal(token, "Pixel") as Effect.Effect<any, unknown, never>),
    ).toMatchObject({ named: false, reason: "unnameable" })
  })
})

describe("claimed platform capture", () => {
  const IPHONE_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
  const MAC_UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

  beforeEach(async () => {
    await truncateAll()
  })

  it("records the claiming device's kind from the UA when naming, in its own column", async () => {
    const { token, serial } = await testRunEffect(seedNamedable() as Effect.Effect<any, unknown, never>)
    await testRunEffect(nameDeviceFromReveal(token, "perso", IPHONE_UA) as Effect.Effect<any, unknown, never>)
    const cert = await testRunEffect(readCert(serial!) as Effect.Effect<any, unknown, never>)
    // The label is the user's word; the platform is the server's observation.
    expect(cert?.label).toBe("perso")
    expect(cert?.claimedPlatform).toBe("iPhone")
  })

  it("records the platform on reveal even when the user never names the device", async () => {
    const { token, serial } = await testRunEffect(seedNamedable() as Effect.Effect<any, unknown, never>)
    expect(await testRunEffect(consumeReveal(token, IPHONE_UA) as Effect.Effect<any, unknown, never>)).toBe(true)
    const cert = await testRunEffect(readCert(serial!) as Effect.Effect<any, unknown, never>)
    expect(cert?.claimedPlatform).toBe("iPhone")
  })

  it("keeps the FIRST observation — a later visit cannot rewrite what claimed the cert", async () => {
    const { token, serial } = await testRunEffect(seedNamedable() as Effect.Effect<any, unknown, never>)
    expect(await testRunEffect(consumeReveal(token, IPHONE_UA) as Effect.Effect<any, unknown, never>)).toBe(true)
    // Naming later from a different browser must not overwrite the platform.
    await testRunEffect(nameDeviceFromReveal(token, "perso", MAC_UA) as Effect.Effect<any, unknown, never>)
    const cert = await testRunEffect(readCert(serial!) as Effect.Effect<any, unknown, never>)
    expect(cert?.label).toBe("perso")
    expect(cert?.claimedPlatform).toBe("iPhone")
  })

  it("stores nothing when the UA says nothing recognisable", async () => {
    const { token, serial } = await testRunEffect(seedNamedable() as Effect.Effect<any, unknown, never>)
    await testRunEffect(nameDeviceFromReveal(token, "mystery box", "curl/8.6.0") as Effect.Effect<any, unknown, never>)
    const cert = await testRunEffect(readCert(serial!) as Effect.Effect<any, unknown, never>)
    expect(cert?.claimedPlatform).toBeNull()
  })
})
