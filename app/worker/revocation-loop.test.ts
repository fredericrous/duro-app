// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest"
import { ConfigProvider, Effect, Layer, Logger, Ref } from "effect"
import * as HttpClient from "@effect/platform/HttpClient"
import * as HttpClientResponse from "@effect/platform/HttpClientResponse"
import * as SqlClient from "@effect/sql/SqlClient"
import { CertificateRepo } from "~/lib/services/CertificateRepo.server"
import { CrlDb, CrlDbLive, initialCrlPublisherState } from "~/lib/services/CrlPublisher.server"
import { VaultCrl, VaultCrlLive } from "~/lib/services/VaultPki.server"
import { sweepRevocations } from "~/lib/workflows/revocation-sweep.server"
import { crlPublisherWorkerLoop, makeRevocationSweeperLayer, revocationSweepLoop } from "./revocation-loop"
import { testRunEffect, truncateAll } from "~/test/test-runtime"

const run = <A>(e: Effect.Effect<A, any, any>) => testRunEffect(e as Effect.Effect<A, unknown, never>)

const seed = (serialNumber: string) =>
  Effect.gen(function* () {
    const repo = yield* CertificateRepo
    yield* repo.store({
      username: "alice",
      email: "alice@example.com",
      serialNumber,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 90 * 86_400_000),
    })
  })

const read = (serialNumber: string) =>
  Effect.gen(function* () {
    const repo = yield* CertificateRepo
    return yield* repo.findBySerial(serialNumber)
  })

beforeEach(async () => {
  await truncateAll()
})

const vaultConfig = ConfigProvider.fromMap(
  new Map([
    ["NAS_VAULT_ADDR", "https://vault.test"],
    ["NAS_VAULT_TOKEN", "test-token"],
  ]),
)

/** A Vault whose revoke endpoint answers 503 for the listed serials and 200 otherwise. */
const stubVault = (failingSerials: ReadonlyArray<string>) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      const sentBody = request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : ""
      const failing = failingSerials.some((serial) => sentBody.includes(serial))
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(failing ? "vault unavailable" : "{}", { status: failing ? 503 : 200 }),
        ),
      )
    }),
  )

const sweepThroughProductionLayer = (failingSerials: ReadonlyArray<string>) =>
  sweepRevocations.pipe(
    Effect.provide(makeRevocationSweeperLayer(stubVault(failingSerials))),
    Effect.withConfigProvider(vaultConfig),
  )

describe("sweepRevocations through the worker's production layer", () => {
  it("turns a failed row completed", async () => {
    await run(
      Effect.gen(function* () {
        const repo = yield* CertificateRepo
        const sql = yield* SqlClient.SqlClient
        yield* seed("SN-RETRY")
        yield* repo.markRevokeFailed("SN-RETRY", "vault down")
        yield* sql`UPDATE user_certificates SET revoke_next_at = NOW() - INTERVAL '1 minute'`
      }),
    )

    expect(await run(sweepThroughProductionLayer([]))).toBe(1)

    const row = await run(read("SN-RETRY"))
    expect(row?.revokeState).toBe("completed")
    expect(row?.revokedAt).not.toBeNull()
  })

  it("completes the other serial when Vault fails one, and counts the failed attempt", async () => {
    await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seed("SN-BAD")
        yield* seed("SN-GOOD")
        yield* sql`UPDATE user_certificates SET revoke_state = 'pending', revoke_next_at = NULL`
      }),
    )

    expect(await run(sweepThroughProductionLayer(["SN-BAD"]))).toBe(2)

    const bad = await run(read("SN-BAD"))
    const good = await run(read("SN-GOOD"))
    expect(good?.revokeState).toBe("completed")
    expect(bad?.revokeState).toBe("failed")
    expect(bad?.revokedAt).toBeNull()
    const attempts = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{
          revokeAttempts: number
        }>`SELECT revoke_attempts FROM user_certificates WHERE serial_number = 'SN-BAD'`
      }),
    )
    expect(Number(attempts[0].revokeAttempts)).toBe(1)
  })
})

describe("CrlDbLive on the real schema", () => {
  const query = Effect.gen(function* () {
    const db = yield* CrlDb
    return {
      watermark: yield* db.revocationWatermark,
      completed: yield* db.completedUnexpiredSerials,
      pending: yield* db.pendingRevocations,
    }
  }).pipe(Effect.provide(CrlDbLive))

  it("reads the watermark, completed unexpired serials and pending count", async () => {
    expect(await run(query)).toEqual({ watermark: null, completed: [], pending: 0 })

    await run(
      Effect.gen(function* () {
        const repo = yield* CertificateRepo
        const sql = yield* SqlClient.SqlClient
        yield* seed("AA:01")
        yield* seed("AA:02")
        yield* seed("AA:03")
        yield* seed("AA:04")
        yield* repo.markRevokeCompleted("AA:01")
        yield* repo.markRevokeCompleted("AA:04")
        yield* sql`UPDATE user_certificates SET expires_at = NOW() - INTERVAL '1 day' WHERE serial_number = 'AA:04'`
        yield* repo.markRevokeFailed("AA:02", "vault down")
      }),
    )

    const after = await run(query)
    expect(after.watermark).not.toBeNull()
    expect(after.completed).toEqual(["AA:01"])
    expect(after.pending).toBe(1)
  })
})

describe("VaultCrlLive", () => {
  const PEM = "-----BEGIN X509 CRL-----\nMIIB\n-----END X509 CRL-----\n"
  const requests: string[] = []
  const vault = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      requests.push(`${request.method} ${request.url}`)
      const respond = (body: string, status = 200) =>
        Effect.succeed(HttpClientResponse.fromWeb(request, new Response(body, { status })))
      if (request.url.endsWith("/pki-client/crl/pem")) return respond(PEM)
      if (request.url.endsWith("/pki-client/cert/ca")) return respond(JSON.stringify({ data: { certificate: "CA" } }))
      if (request.url.endsWith("/secret/data/pki/client-crl") && request.method === "GET") return respond("{}", 404)
      return respond("{}")
    }),
  )
  const viaVault = <A, E>(e: Effect.Effect<A, E, VaultCrl>) =>
    e.pipe(Effect.provide(VaultCrlLive), Effect.provide(vault), Effect.withConfigProvider(vaultConfig))

  it("returns crl/pem as text, the CA from JSON, null for an unwritten KV entry, and writes ca.crl", async () => {
    const got = await run(
      viaVault(
        Effect.gen(function* () {
          const v = yield* VaultCrl
          yield* v.rotateCrl
          const out = { pem: yield* v.getCrlPem, ca: yield* v.getCaPem, kv: yield* v.readPublishedCrl }
          yield* v.writePublishedCrl(PEM)
          return out
        }),
      ),
    )
    expect(got).toEqual({ pem: PEM, ca: "CA", kv: null })
    expect(requests).toEqual([
      "GET https://vault.test/v1/pki-client/crl/rotate",
      "GET https://vault.test/v1/pki-client/crl/pem",
      "GET https://vault.test/v1/pki-client/cert/ca",
      "GET https://vault.test/v1/secret/data/pki/client-crl",
      "POST https://vault.test/v1/secret/data/pki/client-crl",
    ])
  })
})

describe("crlPublisherWorkerLoop without Vault configuration", () => {
  it("logs that the publisher is disabled and returns instead of failing", async () => {
    const messages: string[] = []
    const capture = Logger.replace(
      Logger.defaultLogger,
      Logger.make(({ message }) => void messages.push(String(message))),
    )
    const state = await run(Ref.make(initialCrlPublisherState))

    await run(
      crlPublisherWorkerLoop(stubVault([]), state).pipe(
        Effect.withConfigProvider(ConfigProvider.fromMap(new Map())),
        Effect.provide(capture),
      ),
    )

    expect(messages.join("\n")).toContain("worker: CRL publisher disabled: Vault layer unavailable")
  })
})

describe("revocationSweepLoop without Vault configuration", () => {
  it("logs that the sweeper is disabled and returns instead of failing", async () => {
    const messages: string[] = []
    const capture = Logger.replace(
      Logger.defaultLogger,
      Logger.make(({ message }) => void messages.push(String(message))),
    )

    await run(
      revocationSweepLoop(stubVault([])).pipe(
        Effect.withConfigProvider(ConfigProvider.fromMap(new Map())),
        Effect.provide(capture),
      ),
    )

    expect(messages.join("\n")).toContain("worker: revocation sweeper disabled: Vault layer unavailable")
  })
})
