// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest"
import { ConfigProvider, Effect, Layer, Logger } from "effect"
import * as HttpClient from "@effect/platform/HttpClient"
import * as HttpClientResponse from "@effect/platform/HttpClientResponse"
import * as SqlClient from "@effect/sql/SqlClient"
import { CertificateRepo } from "~/lib/services/CertificateRepo.server"
import { sweepRevocations, makeRevocationSweeperLayer, revocationSweepLoop } from "./revocation-sweep.server"
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

describe("sweepRevocations", () => {
  it("completes a failed row and a pending row with NULL revoke_next_at, leaving a future one alone", async () => {
    await run(
      Effect.gen(function* () {
        const repo = yield* CertificateRepo
        const sql = yield* SqlClient.SqlClient
        yield* seed("SN-FAILED")
        yield* seed("SN-ORPHAN")
        yield* seed("SN-LATER")
        yield* repo.markRevokeFailed("SN-FAILED", "vault down")
        yield* sql`UPDATE user_certificates SET revoke_next_at = NOW() - INTERVAL '1 minute' WHERE serial_number = 'SN-FAILED'`
        yield* sql`UPDATE user_certificates SET revoke_state = 'pending', revoke_next_at = NULL WHERE serial_number = 'SN-ORPHAN'`
        yield* repo.markRevokePending("SN-LATER") // revoke_next_at = now + 2 min
      }),
    )

    const attempted = await run(sweepRevocations)

    expect(attempted).toBe(2)
    for (const serial of ["SN-FAILED", "SN-ORPHAN"]) {
      const row = await run(read(serial))
      expect(row?.revokeState).toBe("completed")
      expect(row?.revokedAt).not.toBeNull()
    }
    const later = await run(read("SN-LATER"))
    expect(later?.revokeState).toBe("pending")
    expect(later?.revokedAt).toBeNull()
  })
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

    expect(messages.join("\n")).toContain("revocation sweeper disabled")
  })
})
