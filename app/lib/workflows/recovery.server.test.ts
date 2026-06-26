// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest"
import { Effect } from "effect"
import { truncateAll, testRunEffect } from "~/test/test-runtime"
import { requestRecovery, approveRecovery, denyRecovery } from "./recovery.server"
import { RecoveryRepo } from "~/lib/services/RecoveryRepo.server"
import { CertificateRepo } from "~/lib/services/CertificateRepo.server"
import { DiscordNotifier } from "~/lib/services/DiscordNotifier.server"

beforeEach(async () => {
  await truncateAll()
})

// Override the dev notifier with a capturing one for assertions.
const withDiscord = <A, E, R>(eff: Effect.Effect<A, E, R>, calls: string[]) =>
  eff.pipe(
    Effect.provideService(DiscordNotifier, {
      notify: (content: string) => Effect.sync(() => void calls.push(content)),
    }),
  )

// All deps (RecoveryRepo, UserManagerDev with alice/bob, CertManagerDev,
// CertRevealRepo, AuditServiceDev, EmailServiceDev) come from TestAppLayer.
const run = <A>(e: Effect.Effect<A, any, any>) => testRunEffect(e as Effect.Effect<A, unknown, never>)

const listPending = () =>
  run(
    Effect.gen(function* () {
      const repo = yield* RecoveryRepo
      return yield* repo.listByStatus("pending")
    }),
  )

const findById = (id: string) =>
  run(
    Effect.gen(function* () {
      const repo = yield* RecoveryRepo
      return yield* repo.findById(id)
    }),
  )

describe("requestRecovery", () => {
  it("creates a pending request for a known account", async () => {
    await run(requestRecovery({ email: "Alice@Example.com", note: "lost laptop", requestIp: "1.2.3.4" }))
    const pending = await listPending()
    expect(pending.length).toBe(1)
    expect(pending[0].email).toBe("alice@example.com") // normalized
    expect(pending[0].username).toBe("alice")
    expect(pending[0].note).toBe("lost laptop")
  })

  it("is a silent no-op for an unknown account (anti-enumeration)", async () => {
    await run(requestRecovery({ email: "nobody@example.com" }))
    expect((await listPending()).length).toBe(0)
  })

  it("is a silent no-op for an invalid email", async () => {
    await run(requestRecovery({ email: "not-an-email" }))
    expect((await listPending()).length).toBe(0)
  })

  it("dedups — a second request does not create a second pending row", async () => {
    await run(requestRecovery({ email: "alice@example.com" }))
    await run(requestRecovery({ email: "alice@example.com" }))
    expect((await listPending()).length).toBe(1)
  })

  it("pings Discord (with the review link) when a request is created", async () => {
    const calls: string[] = []
    await run(withDiscord(requestRecovery({ email: "alice@example.com", note: "lost laptop" }), calls))
    expect(calls.length).toBe(1)
    expect(calls[0]).toContain("alice@example.com")
    expect(calls[0]).toContain("lost laptop")
    expect(calls[0]).toContain("/admin/recovery")
  })

  it("does not ping Discord for an unknown account", async () => {
    const calls: string[] = []
    await run(withDiscord(requestRecovery({ email: "nobody@example.com" }), calls))
    expect(calls.length).toBe(0)
  })
})

describe("approveRecovery / denyRecovery", () => {
  const seedRequest = async () => {
    await run(requestRecovery({ email: "bob@example.com" }))
    const [req] = await listPending()
    return req
  }

  it("approve issues a cert and marks the request approved (without revoking)", async () => {
    const req = await seedRequest()
    const result = await run(approveRecovery(req.id, "admin", false))
    expect(result).toMatchObject({ email: "bob@example.com", revokedCount: 0 })

    const after = await findById(req.id)
    expect(after?.status).toBe("approved")
    expect(after?.reviewedBy).toBe("admin")
    expect(after?.renewalId).not.toBeNull()
  })

  it("approve with revokeOthers revokes the user's existing certs first", async () => {
    // Seed an existing ("lost") device cert for bob.
    await run(
      Effect.gen(function* () {
        const certRepo = yield* CertificateRepo
        yield* certRepo.store({
          inviteId: null,
          userId: "bob",
          username: "bob",
          email: "bob@example.com",
          label: "old phone",
          serialNumber: "OLD-LOST-1",
          issuedAt: new Date(),
          expiresAt: new Date(Date.now() + 1_000_000_000),
        })
      }),
    )

    const req = await seedRequest()
    const result = await run(approveRecovery(req.id, "admin", true))
    expect(result.revokedCount).toBe(1) // the lost cert (the fresh one is issued after)
  })

  it("deny marks the request denied (no cert issued)", async () => {
    const req = await seedRequest()
    await run(denyRecovery(req.id, "admin"))
    const after = await findById(req.id)
    expect(after?.status).toBe("denied")
    expect(after?.renewalId).toBeNull()
  })

  it("approve fails for an unknown / non-pending request", async () => {
    const exit = await run(approveRecovery("does-not-exist", "admin", false).pipe(Effect.either))
    expect((exit as { _tag: string })._tag).toBe("Left")
  })
})
