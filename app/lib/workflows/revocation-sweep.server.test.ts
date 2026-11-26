// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest"
import { Effect } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { CertificateRepo } from "~/lib/services/CertificateRepo.server"
import { sweepRevocations } from "./revocation-sweep.server"
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
