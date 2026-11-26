// @vitest-environment node
//
// Configure env BEFORE imports — ClientCaTrustLive reads NAS_VAULT_ADDR at
// layer-build time. Base URL must match VAULT_BASE in msw-server.ts.
process.env.NAS_VAULT_ADDR = "http://vault.test:8200"

import { describe, expect, it } from "vitest"
import { it as effectIt } from "@effect/vitest"
import { Effect, Fiber, Layer, ManagedRuntime, Option, TestClock } from "effect"
import { FetchHttpClient } from "@effect/platform"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { http, HttpResponse, server, VAULT_BASE } from "~/test/msw-server"
import { ClientCaTrust, ClientCaTrustLive } from "./ClientCaTrust.server"

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../test/fixtures/xfcc-trust/${name}.pem`, import.meta.url)), "utf8")
const CLIENT_CA = fixture("client-ca")
const LEAF_CLIENT_CA = fixture("leaf-client-ca")
const LEAF_IMPOSTOR_CA = fixture("leaf-impostor-ca")
const LEAF_BREAKGLASS_CA = fixture("leaf-breakglass-ca")

const CA_URL = `${VAULT_BASE}/v1/pki-client/cert/ca`

/** Serve the CA, counting calls so caching is observable. */
function serveCa(status = 200) {
  const calls = { count: 0 }
  server.use(
    http.get(CA_URL, () => {
      calls.count++
      return status === 200
        ? HttpResponse.json({ data: { certificate: CLIENT_CA } })
        : HttpResponse.json({ errors: ["sealed"] }, { status })
    }),
  )
  return calls
}

const makeRuntime = () => ManagedRuntime.make(ClientCaTrustLive.pipe(Layer.provide(FetchHttpClient.layer)))

const check = (rt: ReturnType<typeof makeRuntime>, pem: string) =>
  rt.runPromise(
    Effect.gen(function* () {
      const trust = yield* ClientCaTrust
      return yield* trust.isIssuedByClientCa(pem)
    }),
  )

describe("ClientCaTrustLive", () => {
  it("accepts a client-CA leaf and rejects the impostor and break-glass leaves", async () => {
    serveCa()
    const rt = makeRuntime()
    expect(await check(rt, LEAF_CLIENT_CA)).toBe(true)
    expect(await check(rt, LEAF_IMPOSTOR_CA)).toBe(false)
    expect(await check(rt, LEAF_BREAKGLASS_CA)).toBe(false)
    await rt.dispose()
  })

  it("fetches the CA once and serves later checks from the cache", async () => {
    const calls = serveCa()
    const rt = makeRuntime()
    await check(rt, LEAF_CLIENT_CA)
    await check(rt, LEAF_CLIENT_CA)
    await check(rt, LEAF_BREAKGLASS_CA)
    expect(calls.count).toBe(1)
    await rt.dispose()
  })

  it("fails closed when the CA has never been fetched and Vault is unavailable", async () => {
    serveCa(503)
    const rt = makeRuntime()
    expect(await check(rt, LEAF_CLIENT_CA)).toBe(false)
    await rt.dispose()
  })

  effectIt.effect("keeps serving the cached CA when a refresh after the TTL fails", () =>
    Effect.gen(function* () {
      const up = serveCa()
      const trust = yield* ClientCaTrust
      expect(yield* trust.isIssuedByClientCa(LEAF_CLIENT_CA)).toBe(true)
      expect(up.count).toBe(1)

      yield* TestClock.adjust("2 hours") // past the 1 h TTL: the next check refetches
      const down = serveCa(503)
      expect(yield* trust.isIssuedByClientCa(LEAF_CLIENT_CA)).toBe(true) // stale, still proven
      expect(yield* trust.isIssuedByClientCa(LEAF_BREAKGLASS_CA)).toBe(false)
      expect(down.count).toBeGreaterThanOrEqual(1)
    }).pipe(Effect.provide(ClientCaTrustLive.pipe(Layer.provide(FetchHttpClient.layer)))),
  )

  effectIt.effect("a caller that stops waiting does not cancel the CA refresh: it fills the cache", () =>
    // The revoked-cert notice waits 300 ms at most for a CA check it runs in a
    // daemon fiber (presented-cert.server.ts). A Vault slower than that must
    // still warm the cache for the next check, not be cancelled every time.
    // Vault answers only when the test opens the gate: no real wait.
    Effect.gen(function* () {
      let openGate!: () => void
      const gate = new Promise<void>((resolve) => (openGate = resolve))
      const calls = { count: 0 }
      server.use(
        http.get(CA_URL, async () => {
          calls.count++
          await gate
          return HttpResponse.json({ data: { certificate: CLIENT_CA } })
        }),
      )
      const trust = yield* ClientCaTrust
      const refresh = yield* Effect.forkDaemon(trust.isIssuedByClientCa(LEAF_CLIENT_CA))
      const waiter = yield* Effect.fork(Fiber.join(refresh).pipe(Effect.timeoutOption("300 millis")))
      yield* TestClock.adjust("300 millis")
      expect(yield* Fiber.join(waiter)).toEqual(Option.none()) // the caller gave up

      openGate() // Vault answers after the caller left
      expect(yield* Fiber.join(refresh)).toBe(true) // the refresh still finished
      expect(yield* trust.isIssuedByClientCa(LEAF_CLIENT_CA)).toBe(true) // from the cache
      expect(calls.count).toBe(1)
    }).pipe(Effect.provide(ClientCaTrustLive.pipe(Layer.provide(FetchHttpClient.layer)))),
  )

  effectIt.effect("gives up on a Vault fetch after 5 s and fails closed with nothing cached", () =>
    Effect.gen(function* () {
      server.use(http.get(CA_URL, () => new Promise<Response>(() => {})))
      const trust = yield* ClientCaTrust
      const fiber = yield* Effect.fork(trust.isIssuedByClientCa(LEAF_CLIENT_CA))
      yield* TestClock.adjust("5 seconds")
      expect(yield* Fiber.join(fiber)).toBe(false)
    }).pipe(Effect.provide(ClientCaTrustLive.pipe(Layer.provide(FetchHttpClient.layer)))),
  )

  effectIt.effect("gives up on a Vault fetch after 5 s and keeps the cached CA", () =>
    Effect.gen(function* () {
      serveCa()
      const trust = yield* ClientCaTrust
      expect(yield* trust.isIssuedByClientCa(LEAF_CLIENT_CA)).toBe(true)
      yield* TestClock.adjust("2 hours") // past the TTL: the next check refetches
      server.use(http.get(CA_URL, () => new Promise<Response>(() => {})))
      const fiber = yield* Effect.fork(trust.isIssuedByClientCa(LEAF_CLIENT_CA))
      yield* TestClock.adjust("5 seconds")
      expect(yield* Fiber.join(fiber)).toBe(true)
    }).pipe(Effect.provide(ClientCaTrustLive.pipe(Layer.provide(FetchHttpClient.layer)))),
  )

  it("fails closed on a 200 that carries no certificate", async () => {
    server.use(http.get(CA_URL, () => HttpResponse.json({ data: {} })))
    const rt = makeRuntime()
    expect(await check(rt, LEAF_CLIENT_CA)).toBe(false)
    await rt.dispose()
  })
})
