// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { it as effectIt } from "@effect/vitest"
import { Deferred, Effect, Fiber, Layer, Option, Ref, TestClock } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { disposeTestRuntime, seedTestDb, testRunEffect, truncateAll } from "~/test/test-runtime"
import { ClientCaTrust, clientCaTrustOf } from "~/lib/services/ClientCaTrust.server"
import { CertificateRepo, CertificateRepoError } from "~/lib/services/CertificateRepo.server"
import {
  emailOnly,
  isRestricted,
  presentedCertStatus,
  presentedRevokedCert,
  presentedRevokedNotice,
} from "./presented-cert.server"

// The fixture cert canonicalizes to serial "a1b2c3d4e5f"; Vault stores it in colon form.
const FIXTURE_PEM = readFileSync(
  fileURLToPath(new URL("../../test/fixtures/client-cert-fixture.pem", import.meta.url)),
  "utf8",
)
const XFCC = `Cert="${encodeURIComponent(FIXTURE_PEM)}"`
const STORED_SERIAL = "0a:1b:2c:3d:4e:5f"
const REVOKED_AT = "2026-09-23T16:22:23.000Z"

const seedCert = (opts: { username?: string; revokedAt?: string | null; label?: string | null } = {}) =>
  seedTestDb(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const expires = new Date(Date.now() + 30 * 86400_000).toISOString()
      yield* sql`INSERT INTO user_certificates (id, username, email, serial_number, issued_at, expires_at, revoked_at, label)
                 VALUES ('cert-1', ${opts.username ?? "daddy"}, 'daddy@example.com', ${STORED_SERIAL},
                         ${new Date().toISOString()}, ${expires},
                         ${opts.revokedAt === undefined ? REVOKED_AT : opts.revokedAt}, ${opts.label ?? null})`
    }) as Effect.Effect<void, never, never>,
  )

/** The issuer check, stubbed: the pki-client CA signed every certificate, or none. */
const signedByClientCa = Layer.succeed(
  ClientCaTrust,
  clientCaTrustOf(() => Effect.succeed("issued")),
)
const signedByAnotherCa = Layer.succeed(
  ClientCaTrust,
  clientCaTrustOf(() => Effect.succeed("not-issued")),
)
/** No CA could be obtained (Vault down, nothing cached): not the same as another CA. */
const noCaAvailable = Layer.succeed(
  ClientCaTrust,
  clientCaTrustOf(() => Effect.succeed("unknown")),
)

const run = <A>(effect: Effect.Effect<A, never, CertificateRepo | ClientCaTrust>) => testRunEffect(effect)

beforeEach(async () => {
  await truncateAll()
})

afterAll(async () => {
  await disposeTestRuntime()
})

describe("presentedRevokedCert (PGlite)", () => {
  it("is Some for the owner's revoked cert", async () => {
    await seedCert({ label: "iPhone" })
    const hit = await run(presentedRevokedCert(XFCC, "daddy"))
    expect(hit).toEqual(Option.some({ serial: "a1b2c3d4e5f", revokedAt: expect.any(String), label: "iPhone" }))
    expect(new Date(Option.getOrThrow(hit).revokedAt).toISOString()).toBe(REVOKED_AT)
  })

  it("is None with no header, an unparsable header, or no signed-in user", async () => {
    await seedCert()
    expect(await run(presentedRevokedCert(null, "daddy"))).toEqual(Option.none())
    expect(await run(presentedRevokedCert('Cert="not-a-pem"', "daddy"))).toEqual(Option.none())
    expect(await run(presentedRevokedCert(XFCC, null))).toEqual(Option.none())
  })

  it("is None for an unrevoked cert", async () => {
    await seedCert({ revokedAt: null })
    expect(await run(presentedRevokedCert(XFCC, "daddy"))).toEqual(Option.none())
  })

  it("is None for another user's revoked cert", async () => {
    await seedCert({ username: "alice" })
    expect(await run(presentedRevokedCert(XFCC, "daddy"))).toEqual(Option.none())
  })

  it("is None for a serial duro does not know", async () => {
    expect(await run(presentedRevokedCert(XFCC, "daddy"))).toEqual(Option.none())
  })

  it("is None for a cert the pki-client CA did not sign", async () => {
    await seedCert()
    expect(await run(presentedRevokedCert(XFCC, "daddy").pipe(Effect.provide(signedByAnotherCa)))).toEqual(
      Option.none(),
    )
  })

  it("maps to the loader-data shape: an object on a hit, null otherwise", async () => {
    await seedCert({ label: null })
    const notice = await run(presentedRevokedNotice(XFCC, "daddy"))
    expect(notice).toEqual({ revokedAt: expect.any(String), label: null })
    expect(await run(presentedRevokedNotice(null, "daddy"))).toBeNull()
  })
})

describe("presentedRevokedCert (stubbed services)", () => {
  /** A repo that answers `findBySerialCanonical` with `answer`; nothing else is used. */
  const repoLayer = (answer: Effect.Effect<unknown, CertificateRepoError>) =>
    Layer.succeed(CertificateRepo, { findBySerialCanonical: () => answer } as never)
  const ownedRevoked = Effect.succeed({
    username: "daddy",
    revokedAt: REVOKED_AT,
    label: null,
    serialNumber: STORED_SERIAL,
  })

  effectIt.effect("is None when the repo fails", () =>
    presentedRevokedCert(XFCC, "daddy").pipe(
      Effect.tap((hit) => Effect.sync(() => expect(hit).toEqual(Option.none()))),
      Effect.provide(
        Layer.mergeAll(repoLayer(Effect.fail(new CertificateRepoError({ message: "db down" }))), signedByClientCa),
      ),
    ),
  )

  effectIt.effect("is None when a dependency dies (a defect, not a typed failure)", () =>
    presentedRevokedCert(XFCC, "daddy").pipe(
      Effect.tap((hit) => Effect.sync(() => expect(hit).toEqual(Option.none()))),
      Effect.provide(Layer.mergeAll(repoLayer(Effect.die(new RangeError("bad row"))), signedByClientCa)),
    ),
  )

  effectIt.effect("a timed-out request does not cancel the CA check: it runs to its end", () =>
    // The CA check is where ClientCaTrustLive refreshes its cache from Vault.
    // A request that stops waiting after 300 ms must leave it running, or a
    // slow Vault would never warm the cache (the daemon fiber in the check).
    Effect.gen(function* () {
      const vaultAnswers = yield* Deferred.make<void>()
      const finished = yield* Ref.make(false)
      const slowTrust = Layer.succeed(
        ClientCaTrust,
        clientCaTrustOf(() =>
          Deferred.await(vaultAnswers).pipe(Effect.zipRight(Ref.set(finished, true)), Effect.as("issued" as const)),
        ),
      )
      const check = presentedRevokedCert(XFCC, "daddy").pipe(
        Effect.provide(Layer.mergeAll(repoLayer(ownedRevoked), slowTrust)),
      )

      const first = yield* Effect.fork(check)
      yield* TestClock.adjust("300 millis")
      expect(yield* Fiber.join(first)).toEqual(Option.none()) // the request gave up

      yield* Deferred.succeed(vaultAnswers, undefined) // Vault answers after it left
      yield* Effect.yieldNow()
      expect(yield* Ref.get(finished)).toBe(true) // the CA check was not interrupted
    }),
  )

  const statusWith = (repo: Effect.Effect<unknown, CertificateRepoError>, trust: Layer.Layer<ClientCaTrust>) =>
    presentedCertStatus(XFCC, "daddy").pipe(Effect.provide(Layer.mergeAll(repoLayer(repo), trust)))

  effectIt.effect("status: Revoked for a proven revoked certificate of the user", () =>
    Effect.gen(function* () {
      const status = yield* statusWith(ownedRevoked, signedByClientCa)
      expect(status._tag).toBe("Revoked")
      expect(isRestricted(status)).toBe(true)
      expect(emailOnly(status)).toBe(true)
    }),
  )

  effectIt.effect("status: NotRevoked when the CA did not sign it, and no email-only rule applies", () =>
    Effect.gen(function* () {
      const status = yield* statusWith(ownedRevoked, signedByAnotherCa)
      expect(status._tag).toBe("NotRevoked")
      expect(isRestricted(status)).toBe(false)
      expect(emailOnly(status)).toBe(false)
    }),
  )

  effectIt.effect("status: Unavailable when the lookup fails; not restricted, but email-only (fails closed)", () =>
    Effect.gen(function* () {
      const status = yield* statusWith(Effect.fail(new CertificateRepoError({ message: "db down" })), signedByClientCa)
      expect(status._tag).toBe("Unavailable")
      expect(isRestricted(status)).toBe(false)
      expect(emailOnly(status)).toBe(true)
    }),
  )

  effectIt.effect("status: Unavailable when the lookup itself runs out of time", () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(statusWith(Effect.never, signedByClientCa))
      yield* TestClock.adjust("1 second")
      expect((yield* Fiber.join(fiber))._tag).toBe("Unavailable")
    }),
  )

  effectIt.effect("status: Unproven when a revoked row was found but the CA check ran out of time", () =>
    Effect.gen(function* () {
      const neverAnswers = Layer.succeed(
        ClientCaTrust,
        clientCaTrustOf(() => Effect.never),
      )
      const fiber = yield* Effect.fork(statusWith(ownedRevoked, neverAnswers))
      yield* TestClock.adjust("1 second")
      const status = yield* Fiber.join(fiber)
      expect(status._tag).toBe("Unproven")
      expect(isRestricted(status)).toBe(true)
    }),
  )

  effectIt.effect("status: Unproven when there is no CA to ask (Vault down, nothing cached), not NotRevoked", () =>
    Effect.gen(function* () {
      const status = yield* statusWith(ownedRevoked, noCaAvailable)
      expect(status._tag).toBe("Unproven")
      expect(isRestricted(status)).toBe(true)
    }),
  )

  effectIt.effect("status: NotRevoked with no certificate presented", () =>
    Effect.gen(function* () {
      const status = yield* presentedCertStatus(null, "daddy").pipe(
        Effect.provide(Layer.mergeAll(repoLayer(ownedRevoked), signedByClientCa)),
      )
      expect(status._tag).toBe("NotRevoked")
    }),
  )

  effectIt.effect("is None within its 300 ms budget when the CA check never returns", () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(presentedRevokedCert(XFCC, "daddy"))
      yield* TestClock.adjust("1 second")
      const hit = yield* Fiber.join(fiber)
      expect(hit).toEqual(Option.none())
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          repoLayer(ownedRevoked),
          Layer.succeed(
            ClientCaTrust,
            clientCaTrustOf(() => Effect.never),
          ),
        ),
      ),
    ),
  )
})
