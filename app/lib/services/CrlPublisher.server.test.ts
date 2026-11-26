// @vitest-environment node
import "reflect-metadata"
import * as x509 from "@peculiar/x509"
import { describe, expect, it } from "@effect/vitest"
import { Clock, Effect, Either, Fiber, Layer, Option, Ref, TestClock } from "effect"
import {
  CrlDb,
  CrlInvalid,
  type CrlPublisherState,
  CrlSourceError,
  CYCLE_DEADLINE,
  MAX_REREVOKES_PER_CYCLE,
  PUBLISH_EVERY_MS,
  REREVOKE_TIMEOUT,
  RETRY_AFTER_FAILURE_MS,
  VaultCrl,
  canonicalSerial,
  crlMetricsSnapshot,
  initialCrlPublisherState,
  publisherTick,
  rerevokeBatch,
  validateCrl,
} from "./CrlPublisher.server"
import { CertManager } from "./CertManager.server"

const ALG = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } as const
const DAY = 86_400_000

const makeCa = async (cn: string) => {
  const keys = await crypto.subtle.generateKey(ALG, true, ["sign", "verify"])
  const cert = await x509.X509CertificateGenerator.createSelfSigned({ name: `CN=${cn}`, keys, signingAlgorithm: ALG })
  return { keys, cert, pem: cert.toString("pem") }
}
type Ca = Awaited<ReturnType<typeof makeCa>>

const makeCrl = async (ca: Ca, serials: ReadonlyArray<string>, thisUpdate: Date, nextUpdate: Date) =>
  (
    await x509.X509CrlGenerator.create({
      issuer: ca.cert.subject,
      signingKey: ca.keys.privateKey,
      signingAlgorithm: ALG,
      thisUpdate,
      nextUpdate,
      entries: serials.map((serial) => ({ serialNumber: serial.replace(/:/g, ""), revocationDate: thisUpdate })),
    })
  ).toString("pem")

const pki = Effect.promise(() => Promise.all([makeCa("pki-client"), makeCa("someone-else")]))

/**
 * A fake NAS Vault. Like the real one, each rotate re-signs the CRL from the
 * revoked set with thisUpdate = now (the effect Clock) and nextUpdate = now +
 * validity; `restampOnRotate: false` models a rotate that returns the same CRL.
 */
interface FakeVault {
  revoked: Set<string>
  /** Serials Vault accepts a revoke for but keeps off its CRL. */
  sticky: Set<string>
  validityMs: number
  signer: Ca
  restampOnRotate: boolean
  current: string | null
  kv: string | null
  rotations: number
  writes: number
  revokes: string[]
  rotate: "ok" | "fails" | "hangs"
}

const fakeVaultLayer = (ca: Ca, fakeVault: FakeVault) => {
  const sign = Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis
    const pem = yield* Effect.promise(() =>
      makeCrl(fakeVault.signer, [...fakeVault.revoked], new Date(nowMs), new Date(nowMs + fakeVault.validityMs)),
    )
    fakeVault.current = pem
  })
  const unused = Effect.die("not used by the CRL publisher")
  return Layer.merge(
    Layer.succeed(VaultCrl, {
      rotateCrl: Effect.suspend(() => {
        if (fakeVault.rotate === "fails")
          return Effect.fail(new CrlSourceError({ operation: "rotate", message: "503" }))
        if (fakeVault.rotate === "hangs") return Effect.never
        fakeVault.rotations++
        return fakeVault.restampOnRotate || fakeVault.current === null ? sign : Effect.void
      }),
      getCrlPem: Effect.sync(() => fakeVault.current!),
      getCaPem: Effect.succeed(ca.pem),
      readPublishedCrl: Effect.sync(() => Option.fromNullable(fakeVault.kv)),
      writePublishedCrl: (pem) =>
        Effect.sync(() => {
          fakeVault.kv = pem
          fakeVault.writes++
        }),
    }),
    Layer.succeed(CertManager, {
      issueCertAndP12: () => unused,
      getP12Password: () => unused,
      getP12: () => unused,
      consumeP12Password: () => unused,
      deleteP12Secret: () => unused,
      checkCertProcessed: () => unused,
      deleteCertByUsername: () => unused,
      revokeCert: (serial: string) =>
        Effect.sync(() => {
          fakeVault.revokes.push(serial)
          if (!fakeVault.sticky.has(serial)) {
            fakeVault.revoked.add(serial)
            fakeVault.current = null // the next rotate re-signs with it
          }
        }),
    }),
  )
}

interface FakeDb {
  watermark: string
  completed: string[]
  pending: number
}

const fakeDbLayer = (fakeDb: FakeDb) =>
  Layer.succeed(CrlDb, {
    revocationWatermark: Effect.sync(() => fakeDb.watermark),
    completedUnexpiredSerials: Effect.sync(() => fakeDb.completed),
    pendingRevocations: Effect.sync(() => fakeDb.pending),
  })

const setup = (ca: Ca, vault: Partial<FakeVault> = {}, db: Partial<FakeDb> = {}) => {
  const fakeVault: FakeVault = {
    revoked: new Set(),
    sticky: new Set(),
    validityMs: 7 * DAY,
    signer: ca,
    restampOnRotate: true,
    current: null,
    kv: null,
    rotations: 0,
    writes: 0,
    revokes: [],
    rotate: "ok",
    ...vault,
  }
  const fakeDb: FakeDb = { watermark: "0|", completed: [], pending: 0, ...db }
  return { fakeVault, fakeDb, layer: Layer.merge(fakeVaultLayer(ca, fakeVault), fakeDbLayer(fakeDb)) }
}

const tick = (state: Ref.Ref<CrlPublisherState>, layer: Layer.Layer<VaultCrl | CertManager | CrlDb>) =>
  publisherTick(state).pipe(Effect.provide(layer))

describe("canonicalSerial", () => {
  it("matches Vault's colon hex with a CRL's bare hex, leading zeros either way", () => {
    expect(canonicalSerial("00:6F:5C:7F:04:8F")).toBe("6f5c7f048f")
    expect(canonicalSerial("6f5c7f048f")).toBe("6f5c7f048f")
    expect(canonicalSerial("006f5c7f048f")).toBe("6f5c7f048f")
  })
})

describe("validateCrl", () => {
  it.effect("accepts a CRL the CA signed, valid for 7 days, and lists its serials canonically", () =>
    Effect.gen(function* () {
      const [ca] = yield* pki
      const now = Date.now()
      const pem = yield* Effect.promise(() =>
        makeCrl(ca, ["00:6f:5c", "0a:bc"], new Date(now), new Date(now + 7 * DAY)),
      )
      const crl = yield* validateCrl(pem, ca.pem, now)
      expect([...crl.serials].sort()).toEqual(["6f5c", "abc"])
    }),
  )

  it.effect("refuses a CRL signed by another CA", () =>
    Effect.gen(function* () {
      const [ca, other] = yield* pki
      const now = Date.now()
      const pem = yield* Effect.promise(() => makeCrl(other, [], new Date(now), new Date(now + 7 * DAY)))
      const refusal = yield* Effect.either(validateCrl(pem, ca.pem, now))
      expect(Either.isLeft(refusal) && refusal.left).toBeInstanceOf(CrlInvalid)
      expect(Either.isLeft(refusal) && refusal.left.reason).toContain("not signed")
    }),
  )

  it.effect("refuses a CRL whose nextUpdate is under 3 days away", () =>
    Effect.gen(function* () {
      const [ca] = yield* pki
      const now = Date.now()
      const pem = yield* Effect.promise(() => makeCrl(ca, [], new Date(now), new Date(now + 2 * DAY)))
      const refusal = yield* Effect.either(validateCrl(pem, ca.pem, now))
      expect(Either.isLeft(refusal) && refusal.left.reason).toContain("under 3 days")
    }),
  )

  it.effect("refuses text that is not a CRL", () =>
    Effect.gen(function* () {
      const [ca] = yield* pki
      const refusal = yield* Effect.either(validateCrl("garbage", ca.pem, Date.now()))
      expect(Either.isLeft(refusal) && refusal.left.reason).toContain("not a CRL")
    }),
  )
})

describe("rerevokeBatch", () => {
  it("takes every missing serial in turn when more are missing than one cycle re-revokes", () => {
    const missing = Array.from({ length: MAX_REREVOKES_PER_CYCLE + 3 }, (_, index) => `s${index}`)
    const first = rerevokeBatch(missing, 0)
    const second = rerevokeBatch(missing, first.length)
    expect(first).toHaveLength(MAX_REREVOKES_PER_CYCLE)
    expect(new Set([...first, ...second])).toEqual(new Set(missing))
  })
})

describe("publisherTick", () => {
  it.effect("publishes at start, then not again until a revocation or 6 h later", () =>
    Effect.gen(function* () {
      const [ca] = yield* pki
      const { fakeVault, layer } = setup(ca)
      const state = yield* Ref.make(initialCrlPublisherState)

      expect(yield* tick(state, layer)).toBe(true)
      expect(fakeVault.writes).toBe(1)
      expect(yield* tick(state, layer)).toBe(false)

      yield* TestClock.adjust(PUBLISH_EVERY_MS)
      expect(yield* tick(state, layer)).toBe(true)
      expect(fakeVault.rotations).toBe(2)
    }),
  )

  it.effect("writes KV on each cycle, because each rotate re-signs the CRL", () =>
    Effect.gen(function* () {
      const [ca] = yield* pki
      const { fakeVault, layer } = setup(ca)
      const state = yield* Ref.make(initialCrlPublisherState)
      yield* tick(state, layer)
      yield* TestClock.adjust(PUBLISH_EVERY_MS)
      yield* tick(state, layer)
      expect(fakeVault.writes).toBe(2)
      const published = yield* validateCrl(fakeVault.kv!, ca.pem, yield* Clock.currentTimeMillis)
      expect(published.nextUpdate.getTime()).toBe((yield* Clock.currentTimeMillis) + 7 * DAY)
    }),
  )

  it.effect("collapses a burst of revocations between two ticks into one cycle", () =>
    Effect.gen(function* () {
      const [ca] = yield* pki
      const { fakeVault, fakeDb, layer } = setup(ca)
      const state = yield* Ref.make(initialCrlPublisherState)
      yield* tick(state, layer)

      for (const serial of ["01", "02", "03"]) {
        fakeVault.revoked.add(serial)
        fakeDb.completed.push(serial)
        fakeDb.watermark = `${fakeDb.completed.length}|2026-11-26 10:00:0${serial}`
      }
      expect(yield* tick(state, layer)).toBe(true)
      expect(yield* tick(state, layer)).toBe(false)
      expect(fakeVault.rotations).toBe(2)
      expect(fakeVault.writes).toBe(2)
    }),
  )

  it.effect("skips the KV write when Vault returns the CRL KV already holds, even after a restart", () =>
    Effect.gen(function* () {
      const [ca] = yield* pki
      const { fakeVault, layer } = setup(ca, { restampOnRotate: false })
      yield* tick(yield* Ref.make(initialCrlPublisherState), layer)
      // A fresh state is a restarted worker: it reads KV before comparing.
      expect(yield* tick(yield* Ref.make(initialCrlPublisherState), layer)).toBe(true)
      expect(fakeVault.rotations).toBe(2)
      expect(fakeVault.writes).toBe(1)
    }),
  )

  it.effect("writes nothing when the CRL is invalid, and retries 5 minutes later", () =>
    Effect.gen(function* () {
      const [ca, other] = yield* pki
      const { fakeVault, layer } = setup(ca, { signer: other })
      const state = yield* Ref.make(initialCrlPublisherState)

      expect(yield* tick(state, layer)).toBe(true)
      expect(fakeVault.writes).toBe(0)
      expect(Option.isNone((yield* Ref.get(state)).lastGood)).toBe(true)

      yield* TestClock.adjust(RETRY_AFTER_FAILURE_MS - 1)
      expect(yield* tick(state, layer)).toBe(false)
      yield* TestClock.adjust(1)
      fakeVault.signer = ca
      expect(yield* tick(state, layer)).toBe(true)
      expect(fakeVault.writes).toBe(1)
    }),
  )

  it.effect("refuses a CRL Vault signs for under 3 days", () =>
    Effect.gen(function* () {
      const [ca] = yield* pki
      const { fakeVault, layer } = setup(ca, { validityMs: 2 * DAY })
      yield* tick(yield* Ref.make(initialCrlPublisherState), layer)
      expect(fakeVault.rotations).toBe(1)
      expect(fakeVault.writes).toBe(0)
    }),
  )

  it.effect("re-revokes a completed serial missing from the CRL, then publishes it", () =>
    Effect.gen(function* () {
      const [ca] = yield* pki
      const { fakeVault, layer } = setup(ca, {}, { completed: ["00:6f:5c:7f:04:8f"] })
      const state = yield* Ref.make(initialCrlPublisherState)

      yield* tick(state, layer)

      expect(fakeVault.revokes).toEqual(["00:6f:5c:7f:04:8f"])
      expect(Option.map((yield* Ref.get(state)).lastGood, (cycle) => cycle.missingSerials)).toEqual(Option.some(0))
      const published = yield* validateCrl(fakeVault.kv!, ca.pem, 0)
      expect(published.serials.has("6f5c7f048f")).toBe(true)
    }),
  )

  it.effect("counts a serial Vault keeps off the CRL as missing, without looping", () =>
    Effect.gen(function* () {
      const [ca] = yield* pki
      const { fakeVault, layer } = setup(ca, { sticky: new Set(["0b"]) }, { completed: ["0b"] })
      const state = yield* Ref.make(initialCrlPublisherState)
      yield* tick(state, layer)
      expect(fakeVault.revokes).toEqual(["0b"])
      expect(Option.map((yield* Ref.get(state)).lastGood, (cycle) => cycle.missingSerials)).toEqual(Option.some(1))
    }),
  )

  it.effect("re-revokes the serials past the first batch on the next cycle", () =>
    Effect.gen(function* () {
      const [ca] = yield* pki
      const stuck = Array.from({ length: MAX_REREVOKES_PER_CYCLE + 1 }, (_, index) => `0${(index + 16).toString(16)}`)
      const { fakeVault, layer } = setup(ca, { sticky: new Set(stuck) }, { completed: [...stuck] })
      const state = yield* Ref.make(initialCrlPublisherState)

      yield* tick(state, layer)
      expect(fakeVault.revokes).not.toContain(stuck.at(-1))
      yield* TestClock.adjust(PUBLISH_EVERY_MS)
      yield* tick(state, layer)
      expect(fakeVault.revokes).toContain(stuck.at(-1))
    }),
  )

  it.effect("gives up on a re-revoke that hangs, names it, and still publishes", () =>
    Effect.gen(function* () {
      const [ca] = yield* pki
      const { fakeVault, layer } = setup(ca, {}, { completed: ["0c"] })
      const hangingRevoke = Layer.succeed(CertManager, {
        ...Effect.runSync(CertManager.pipe(Effect.provide(layer))),
        revokeCert: () => Effect.never,
      })
      const state = yield* Ref.make(initialCrlPublisherState)

      const running = yield* Effect.fork(tick(state, Layer.merge(layer, hangingRevoke)))
      yield* TestClock.adjust(REREVOKE_TIMEOUT)
      expect(yield* Fiber.join(running)).toBe(true)
      expect(fakeVault.writes).toBe(1)
      expect(Option.map((yield* Ref.get(state)).lastGood, (cycle) => cycle.missingSerials)).toEqual(Option.some(1))
    }),
  )

  it.effect("survives a failing Vault: no throw, no write", () =>
    Effect.gen(function* () {
      const [ca] = yield* pki
      const { fakeVault, layer } = setup(ca, { rotate: "fails" })
      const state = yield* Ref.make(initialCrlPublisherState)
      expect(yield* tick(state, layer)).toBe(true)
      expect(fakeVault.writes).toBe(0)
    }),
  )

  it.effect("gives up on a hung Vault at the cycle deadline and retries 5 minutes later", () =>
    Effect.gen(function* () {
      const [ca] = yield* pki
      const { fakeVault, layer } = setup(ca, { rotate: "hangs" })
      const state = yield* Ref.make(initialCrlPublisherState)

      const running = yield* Effect.fork(tick(state, layer))
      yield* TestClock.adjust(CYCLE_DEADLINE)
      expect(yield* Fiber.join(running)).toBe(true)

      const nowMs = yield* Clock.currentTimeMillis
      expect((yield* Ref.get(state)).nextCycleAtMs).toBe(nowMs + RETRY_AFTER_FAILURE_MS)
      expect(fakeVault.writes).toBe(0)
    }),
  )
})

describe("crlMetricsSnapshot", () => {
  it.effect("has no last good cycle before the first publish, and one after", () =>
    Effect.gen(function* () {
      const [ca] = yield* pki
      const { layer } = setup(ca, {}, { pending: 2 })
      const state = yield* Ref.make(initialCrlPublisherState)
      const before = yield* crlMetricsSnapshot(state).pipe(Effect.provide(layer))
      expect(before).toEqual({ lastGood: Option.none(), pendingRevocations: 2 })

      yield* tick(state, layer)
      const after = yield* crlMetricsSnapshot(state).pipe(Effect.provide(layer))
      expect(Option.isSome(after.lastGood)).toBe(true)
    }),
  )
})
