// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest"
import { Effect } from "effect"
import { CertificateRepo } from "~/lib/services/CertificateRepo.server"
import { CertManager } from "~/lib/services/CertManager.server"
import { AuditService } from "~/lib/governance/AuditService.server"
import { CertManagerError } from "~/lib/services/CertManager.server"
import { revokeSerialForUser, revokeSupersededCert } from "./cert-revocation.server"
import { testRunEffect, truncateAll } from "~/test/test-runtime"

const seedCert = (serialNumber: string, username: string) =>
  Effect.gen(function* () {
    const repo = yield* CertificateRepo
    yield* repo.store({
      username,
      email: `${username}@example.com`,
      serialNumber,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 90 * 86_400_000),
    })
  })

const readCert = (serialNumber: string) =>
  Effect.gen(function* () {
    const repo = yield* CertificateRepo
    return yield* repo.findBySerial(serialNumber)
  })

beforeEach(async () => {
  await truncateAll()
})

describe("revokeSupersededCert", () => {
  it("revokes the cert a renewal replaced", async () => {
    await testRunEffect(seedCert("SN-SUP", "alice"))
    await testRunEffect(revokeSupersededCert("SN-SUP", "alice"))

    const cert = await testRunEffect(readCert("SN-SUP"))
    expect(cert?.revokeState).toBe("completed")
    expect(cert?.revokedAt).not.toBeNull()
  })

  it("is a no-op for a cert belonging to someone else", async () => {
    await testRunEffect(seedCert("SN-OTHER", "alice"))
    await testRunEffect(revokeSupersededCert("SN-OTHER", "mallory"))

    const cert = await testRunEffect(readCert("SN-OTHER"))
    expect(cert?.revokeState).toBeNull()
    expect(cert?.revokedAt).toBeNull()
  })

  it("is a no-op for an already-revoked cert", async () => {
    await testRunEffect(seedCert("SN-DONE", "alice"))
    await testRunEffect(revokeSupersededCert("SN-DONE", "alice"))
    const first = await testRunEffect(readCert("SN-DONE"))

    // A reveal link opened twice must not thrash the row.
    await testRunEffect(revokeSupersededCert("SN-DONE", "alice"))
    const second = await testRunEffect(readCert("SN-DONE"))
    expect(second?.revokedAt).toEqual(first?.revokedAt)
  })

  it("does not fail when the serial is unknown", async () => {
    // Dangling lineage (the row was purged) must be inert, not an error.
    await expect(testRunEffect(revokeSupersededCert("SN-GHOST", "alice"))).resolves.toBeUndefined()
  })

  it("records a CA failure instead of propagating it", async () => {
    await testRunEffect(seedCert("SN-FAIL", "alice"))

    // The reveal that triggers this must still hand over the password, so a
    // Vault outage can only ever leave a 'failed' row for the user to retry.
    // Overriding the service on the effect (rather than composing a layer)
    // keeps the same runtime — and therefore the same PGlite instance.
    await testRunEffect(
      revokeSupersededCert("SN-FAIL", "alice").pipe(
        Effect.provideService(CertManager, {
          revokeCert: () => Effect.fail(new Error("vault down")),
        } as never),
      ),
    )

    const cert = await testRunEffect(readCert("SN-FAIL"))
    expect(cert?.revokeState).toBe("failed")
    expect(cert?.revokeError).toContain("vault down")
    expect(cert?.revokedAt).toBeNull()
  })
})

const REVOKE_OPTIONS = { auditUsername: "alice", actorId: "admin-sub", path: "admin" } as const

const recordingAudit = (events: Array<{ eventType: string; actorId?: string; metadata?: Record<string, unknown> }>) =>
  AuditService.of({
    emit: (event) => Effect.sync(() => void events.push(event)),
    query: () => Effect.succeed([]),
    subscribe: () => Effect.succeed(() => {}),
  })

const withVault = (
  effect: ReturnType<typeof revokeSerialForUser>,
  events: Array<{ eventType: string; actorId?: string; metadata?: Record<string, unknown> }>,
  revokeCert: () => Effect.Effect<void, CertManagerError>,
) =>
  effect.pipe(
    Effect.provideService(AuditService, recordingAudit(events)),
    Effect.provideService(
      CertManager,
      CertManager.of({
        revokeCert,
        issueCertAndP12: () => Effect.die("not used by revocation"),
        getP12Password: () => Effect.die("not used by revocation"),
        getP12: () => Effect.die("not used by revocation"),
        consumeP12Password: () => Effect.die("not used by revocation"),
        deleteP12Secret: () => Effect.die("not used by revocation"),
        checkCertProcessed: () => Effect.die("not used by revocation"),
        deleteCertByUsername: () => Effect.die("not used by revocation"),
      }),
    ),
  )

describe("revokeSerialForUser", () => {
  it("audits once with the actor and path, and a second revoke of the completed serial adds nothing", async () => {
    await testRunEffect(seedCert("SN-TWICE", "alice"))
    const events: Array<{ eventType: string; actorId?: string; metadata?: Record<string, unknown> }> = []

    const first = await testRunEffect(
      withVault(revokeSerialForUser("SN-TWICE", REVOKE_OPTIONS), events, () => Effect.void),
    )
    const second = await testRunEffect(
      withVault(revokeSerialForUser("SN-TWICE", REVOKE_OPTIONS), events, () => Effect.void),
    )
    // A Vault outage on a repeat must not move a completed row back to failed either.
    const third = await testRunEffect(
      withVault(revokeSerialForUser("SN-TWICE", REVOKE_OPTIONS), events, () =>
        Effect.fail(new CertManagerError({ message: "vault down" })),
      ),
    )

    expect(first._tag).toBe("Revoked")
    expect(second._tag).toBe("Revoked")
    expect(third._tag).toBe("RevokeFailed")
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      eventType: "cert.revoked",
      actorId: "admin-sub",
      metadata: { username: "alice", path: "admin" },
    })
    const row = await testRunEffect(readCert("SN-TWICE"))
    expect(row?.revokeState).toBe("completed")
    expect(row?.revokeError).toBeNull()
    expect(row?.revokedAt).not.toBeNull()
  })

  it("returns RevokeFailed with the error and counts the attempt", async () => {
    await testRunEffect(seedCert("SN-DOWN", "alice"))

    const outcome = await testRunEffect(
      withVault(revokeSerialForUser("SN-DOWN", REVOKE_OPTIONS), [], () =>
        Effect.fail(new CertManagerError({ message: "vault 503" })),
      ),
    )

    expect(outcome).toMatchObject({ _tag: "RevokeFailed" })
    expect(outcome._tag === "RevokeFailed" && outcome.error).toContain("vault 503")
    const row = await testRunEffect(readCert("SN-DOWN"))
    expect(row?.revokeState).toBe("failed")
  })

  it("a permanent Vault refusal caps the attempts so the sweeper stops offering the row", async () => {
    await testRunEffect(seedCert("SN-DENIED", "alice"))

    await testRunEffect(
      withVault(revokeSerialForUser("SN-DENIED", REVOKE_OPTIONS), [], () =>
        Effect.fail(new CertManagerError({ message: "403 permission denied", permanent: true })),
      ),
    )

    const due = await testRunEffect(
      Effect.gen(function* () {
        const repo = yield* CertificateRepo
        return yield* repo.listDueRevocations(10)
      }),
    )
    expect(due.map((cert) => cert.serialNumber)).not.toContain("SN-DENIED")
    const row = await testRunEffect(readCert("SN-DENIED"))
    expect(row?.revokeState).toBe("failed")
    expect(row?.revokedAt).toBeNull()
  })
})
