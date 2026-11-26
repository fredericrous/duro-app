// @vitest-environment node
import "reflect-metadata"
import * as x509 from "@peculiar/x509"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Either, Layer, Ref, TestClock } from "effect"
import {
  CrlDb,
  CrlInvalid,
  type CrlPublisherState,
  PUBLISH_EVERY_MS,
  RETRY_AFTER_FAILURE_MS,
  canonicalSerial,
  initialCrlPublisherState,
  publisherTick,
  renderCrlMetrics,
  validateCrl,
} from "./CrlPublisher.server"
import { VaultCrl, VaultPki, VaultPkiError } from "./VaultPki.server"

const ALG = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } as const
const DAY = 86_400_000

const makeCa = async (cn: string) => {
  const keys = await crypto.subtle.generateKey(ALG, true, ["sign", "verify"])
  const cert = await x509.X509CertificateGenerator.createSelfSigned({ name: `CN=${cn}`, keys, signingAlgorithm: ALG })
  return { keys, cert, pem: cert.toString("pem") }
}
type Ca = Awaited<ReturnType<typeof makeCa>>

const makeCrl = async (ca: Ca, serials: ReadonlyArray<string>, nextUpdate: Date, thisUpdate: Date) =>
  (
    await x509.X509CrlGenerator.create({
      issuer: ca.cert.subject,
      signingKey: ca.keys.privateKey,
      signingAlgorithm: ALG,
      thisUpdate,
      nextUpdate,
      entries: serials.map((s) => ({ serialNumber: s.replace(/:/g, ""), revocationDate: thisUpdate })),
    })
  ).toString("pem")

const pki = Effect.promise(() => Promise.all([makeCa("pki-client"), makeCa("someone-else")]))

/** A fake NAS Vault: the CRL is regenerated from `revoked` on each fetch; calls are counted. */
interface FakeVault {
  revoked: Set<string>
  /** Serials Vault accepts a revoke for but keeps off its CRL. */
  sticky: Set<string>
  validityMs: number
  signer: Ca
  kv: string | null
  rotations: number
  writes: number
  revokes: string[]
  rotateFails: boolean
}

const fakeVaultLayer = (ca: Ca, v: FakeVault) => {
  // Same CRL bytes for the same content, so "unchanged" is observable.
  const cache = new Map<string, string>()
  const crlNow = Effect.gen(function* () {
    const key = [...v.revoked].sort().join(",") + `|${v.validityMs}|${v.signer.pem}`
    const hit = cache.get(key)
    if (hit) return hit
    const pem = yield* Effect.promise(() =>
      makeCrl(v.signer, [...v.revoked], new Date(Date.now() + v.validityMs), new Date(0)),
    )
    cache.set(key, pem)
    return pem
  })
  return Layer.merge(
    Layer.succeed(VaultCrl, {
      rotateCrl: Effect.suspend(() =>
        v.rotateFails
          ? Effect.fail(new VaultPkiError({ message: "503", status: 503 }))
          : Effect.sync(() => void v.rotations++),
      ),
      getCrlPem: crlNow,
      getCaPem: Effect.succeed(ca.pem),
      readPublishedCrl: Effect.sync(() => v.kv),
      writePublishedCrl: (pem) =>
        Effect.sync(() => {
          v.kv = pem
          v.writes++
        }),
    }),
    Layer.succeed(VaultPki, {
      revokeCert: (serial: string) =>
        Effect.sync(() => {
          v.revokes.push(serial)
          if (!v.sticky.has(serial)) v.revoked.add(serial)
        }),
    } as unknown as VaultPki["Type"]),
  )
}

interface FakeDb {
  watermark: string | null
  completed: string[]
  pending: number
}

const fakeDbLayer = (db: FakeDb) =>
  Layer.succeed(CrlDb, {
    revocationWatermark: Effect.sync(() => db.watermark),
    completedUnexpiredSerials: Effect.sync(() => db.completed),
    pendingRevocations: Effect.sync(() => db.pending),
  })

const setup = (ca: Ca, vault: Partial<FakeVault> = {}, db: Partial<FakeDb> = {}) => {
  const v: FakeVault = {
    revoked: new Set(),
    sticky: new Set(),
    validityMs: 7 * DAY,
    signer: ca,
    kv: null,
    rotations: 0,
    writes: 0,
    revokes: [],
    rotateFails: false,
    ...vault,
  }
  const d: FakeDb = { watermark: null, completed: [], pending: 0, ...db }
  return { v, d, layer: Layer.merge(fakeVaultLayer(ca, v), fakeDbLayer(d)) }
}

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
        makeCrl(ca, ["00:6f:5c", "0a:bc"], new Date(now + 7 * DAY), new Date(now)),
      )
      const crl = yield* validateCrl(pem, ca.pem, now)
      expect([...crl.serials].sort()).toEqual(["6f5c", "abc"])
    }),
  )

  it.effect("refuses a CRL signed by another CA", () =>
    Effect.gen(function* () {
      const [ca, other] = yield* pki
      const now = Date.now()
      const pem = yield* Effect.promise(() => makeCrl(other, [], new Date(now + 7 * DAY), new Date(now)))
      const result = yield* Effect.either(validateCrl(pem, ca.pem, now))
      expect(Either.isLeft(result) && result.left).toBeInstanceOf(CrlInvalid)
      expect(Either.isLeft(result) && result.left.reason).toContain("not signed")
    }),
  )

  it.effect("refuses a CRL whose nextUpdate is under 3 days away", () =>
    Effect.gen(function* () {
      const [ca] = yield* pki
      const now = Date.now()
      const pem = yield* Effect.promise(() => makeCrl(ca, [], new Date(now + 2 * DAY), new Date(now)))
      const result = yield* Effect.either(validateCrl(pem, ca.pem, now))
      expect(Either.isLeft(result) && result.left.reason).toContain("under 3 days")
    }),
  )

  it.effect("refuses text that is not a CRL", () =>
    Effect.gen(function* () {
      const [ca] = yield* pki
      const result = yield* Effect.either(validateCrl("garbage", ca.pem, Date.now()))
      expect(Either.isLeft(result) && result.left.reason).toContain("not a CRL")
    }),
  )
})

describe("publisherTick", () => {
  const run = (state: Ref.Ref<CrlPublisherState>, layer: Layer.Layer<VaultCrl | VaultPki | CrlDb>) =>
    publisherTick(state).pipe(Effect.provide(layer))

  it.effect("publishes at start, then not again until a revocation or 6 h later", () =>
    Effect.gen(function* () {
      const [ca] = yield* pki
      const { v, layer } = setup(ca)
      const state = yield* Ref.make(initialCrlPublisherState)

      expect(yield* run(state, layer)).toBe(true)
      expect(v.writes).toBe(1)
      expect(yield* run(state, layer)).toBe(false)

      yield* TestClock.adjust(PUBLISH_EVERY_MS)
      expect(yield* run(state, layer)).toBe(true)
      expect(v.rotations).toBe(2)
    }),
  )

  it.effect("collapses a burst of revocations between two ticks into one cycle", () =>
    Effect.gen(function* () {
      const [ca] = yield* pki
      const { v, d, layer } = setup(ca)
      const state = yield* Ref.make(initialCrlPublisherState)
      yield* run(state, layer)

      for (const serial of ["01", "02", "03"]) {
        v.revoked.add(serial)
        d.completed.push(serial)
        d.watermark = `2026-11-26 10:00:0${serial}`
      }
      expect(yield* run(state, layer)).toBe(true)
      expect(yield* run(state, layer)).toBe(false)
      expect(v.rotations).toBe(2)
      expect(v.writes).toBe(2)
    }),
  )

  it.effect("does not rewrite KV when the CRL is unchanged", () =>
    Effect.gen(function* () {
      const [ca] = yield* pki
      const { v, layer } = setup(ca)
      const state = yield* Ref.make(initialCrlPublisherState)
      yield* run(state, layer)
      yield* TestClock.adjust(PUBLISH_EVERY_MS)
      yield* run(state, layer)
      expect(v.rotations).toBe(2)
      expect(v.writes).toBe(1)
    }),
  )

  it.effect("reads KV first after a restart and skips a write of the same CRL", () =>
    Effect.gen(function* () {
      const [ca] = yield* pki
      const { v, layer } = setup(ca)
      yield* run(yield* Ref.make(initialCrlPublisherState), layer)
      // A fresh state is a restarted worker: it knows nothing of KV until it reads it.
      expect(yield* run(yield* Ref.make(initialCrlPublisherState), layer)).toBe(true)
      expect(v.rotations).toBe(2)
      expect(v.writes).toBe(1)
    }),
  )

  it.effect("writes nothing when the CRL is invalid, and retries 5 minutes later", () =>
    Effect.gen(function* () {
      const [ca, other] = yield* pki
      const { v, layer } = setup(ca, { signer: other })
      const state = yield* Ref.make(initialCrlPublisherState)

      expect(yield* run(state, layer)).toBe(true)
      expect(v.writes).toBe(0)
      expect((yield* Ref.get(state)).publishedSeconds).toBeNull()

      yield* TestClock.adjust(RETRY_AFTER_FAILURE_MS - 1)
      expect(yield* run(state, layer)).toBe(false)
      yield* TestClock.adjust(1)
      v.signer = ca
      expect(yield* run(state, layer)).toBe(true)
      expect(v.writes).toBe(1)
    }),
  )

  it.effect("re-revokes a completed serial missing from the CRL, then publishes it", () =>
    Effect.gen(function* () {
      const [ca] = yield* pki
      const { v, layer } = setup(ca, {}, { completed: ["00:6f:5c:7f:04:8f"] })
      const state = yield* Ref.make(initialCrlPublisherState)

      yield* run(state, layer)

      expect(v.revokes).toEqual(["00:6f:5c:7f:04:8f"])
      expect((yield* Ref.get(state)).missingSerials).toBe(0)
      const published = yield* validateCrl(v.kv!, ca.pem, 0)
      expect(published.serials.has("6f5c7f048f")).toBe(true)
    }),
  )

  it.effect("counts a serial Vault keeps off the CRL as missing, without looping", () =>
    Effect.gen(function* () {
      const [ca] = yield* pki
      const { v, layer } = setup(ca, { sticky: new Set(["0b"]) }, { completed: ["0b"] })
      const state = yield* Ref.make(initialCrlPublisherState)
      yield* run(state, layer)
      expect(v.revokes).toEqual(["0b"])
      expect((yield* Ref.get(state)).missingSerials).toBe(1)
    }),
  )

  it.effect("survives a Vault outage: no throw, no write", () =>
    Effect.gen(function* () {
      const [ca] = yield* pki
      const { v, layer } = setup(ca, { rotateFails: true })
      const state = yield* Ref.make(initialCrlPublisherState)
      expect(yield* run(state, layer)).toBe(true)
      expect(v.writes).toBe(0)
    }),
  )
})

describe("renderCrlMetrics", () => {
  it.effect("omits the timestamps before the first publish, always shows the counts", () =>
    Effect.gen(function* () {
      const [ca] = yield* pki
      const { layer } = setup(ca, {}, { pending: 2 })
      const state = yield* Ref.make(initialCrlPublisherState)
      const before = yield* renderCrlMetrics(state).pipe(Effect.provide(layer))
      expect(before).not.toContain("duro_crl_next_update_timestamp_seconds")
      expect(before).not.toContain("duro_crl_published_timestamp_seconds")
      expect(before).toContain("duro_crl_missing_serials 0")
      expect(before).toContain("duro_revocations_pending 2")

      yield* publisherTick(state).pipe(Effect.provide(layer))
      const after = yield* renderCrlMetrics(state).pipe(Effect.provide(layer))
      expect(after).toMatch(/^duro_crl_next_update_timestamp_seconds \d+$/m)
      expect(after).toMatch(/^duro_crl_published_timestamp_seconds \d+$/m)
      expect(after).toContain("# TYPE duro_revocations_pending gauge")
    }),
  )
})
