import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"
import { handleAdminUsersMutation, parseAdminUsersMutation, type AdminUsersMutation } from "./admin-users"
import { InviteRepo, type Revocation } from "~/lib/services/InviteRepo.server"
import { UserManager } from "~/lib/services/UserManager.server"
import { CertManager } from "~/lib/services/CertManager.server"
import { EmailService } from "~/lib/services/EmailService.server"
import { PreferencesRepo } from "~/lib/services/PreferencesRepo.server"
import { CertificateRepo, type UserCertificate } from "~/lib/services/CertificateRepo.server"

// --- Minimal mock layers ---

const mockCertManager = Layer.succeed(CertManager, {
  issueCert: () => Effect.succeed({ serialNumber: "cert-123", renewalId: "ren-1" }),
  revokeCert: () => Effect.void,
  getP12Password: () => Effect.succeed("test-password"),
  deleteP12Secret: () => Effect.void,
  consumeP12Password: () => Effect.void,
} as any)

const mockCertRepo = (certs: Map<string, UserCertificate> = new Map()) =>
  Layer.succeed(CertificateRepo, {
    store: () => Effect.void,
    listValid: () => Effect.succeed([...certs.values()].filter((c) => !c.revokedAt)),
    listAllByUsernames: () => Effect.succeed({}),
    findBySerial: (sn: string) => Effect.succeed(certs.get(sn) ?? null),
    markRevokePending: (sn: string) => {
      const cert = certs.get(sn)
      if (!cert || cert.revokedAt) return Effect.succeed(0)
      certs.set(sn, { ...cert, revokeState: "pending" })
      return Effect.succeed(1)
    },
    markRevokeCompleted: (sn: string) => {
      const cert = certs.get(sn)
      if (cert) certs.set(sn, { ...cert, revokedAt: new Date().toISOString(), revokeState: "completed" })
      return Effect.void
    },
    markRevokeFailed: (sn: string, error: string) => {
      const cert = certs.get(sn)
      if (cert) certs.set(sn, { ...cert, revokeState: "failed", revokeError: error })
      return Effect.void
    },
    revokeAllForUser: (username: string) => {
      const serials = [...certs.values()]
        .filter((c) => c.username === username && !c.revokedAt)
        .map((c) => c.serialNumber)
      for (const sn of serials) {
        const cert = certs.get(sn)!
        certs.set(sn, { ...cert, revokeState: "pending" })
      }
      return Effect.succeed(serials)
    },
    setUserId: () => Effect.void,
    updateUsername: () => Effect.void,
  } as any)

const revocations: Revocation[] = []

const mockInviteRepo = Layer.succeed(InviteRepo, {
  create: () => Effect.succeed({ id: "inv-1", token: "tok-1" }),
  findById: () => Effect.succeed(null),
  findByTokenHash: () => Effect.succeed(null),
  consumeByToken: () => Effect.fail(new Error("not found")),
  markUsedBy: () => Effect.void,
  findPending: () => Effect.succeed([]),
  incrementAttempt: () => Effect.void,
  markCertIssued: () => Effect.void,
  markPRCreated: () => Effect.void,
  markPRMerged: () => Effect.void,
  markEmailSent: () => Effect.void,
  findAwaitingMerge: () => Effect.succeed([]),
  revoke: () => Effect.void,
  deleteById: () => Effect.void,
  recordReconcileError: () => Effect.void,
  markFailed: () => Effect.void,
  clearReconcileError: () => Effect.void,
  findFailed: () => Effect.succeed([]),
  setCertUsername: () => Effect.void,
  markCertVerified: () => Effect.void,
  findAwaitingCertVerification: () => Effect.succeed([]),
  markRevoking: () => Effect.void,
  markRevertPRCreated: () => Effect.void,
  markRevertPRMerged: () => Effect.void,
  findAwaitingRevertMerge: () => Effect.succeed([]),
  recordRevocation: (email: string, username: string, revokedBy: string, reason?: string) =>
    Effect.sync(() => {
      revocations.push({
        id: `rev-${revocations.length + 1}`,
        email,
        username,
        reason: reason ?? null,
        revokedAt: new Date().toISOString(),
        revokedBy,
      })
    }),
  findRevocations: () => Effect.succeed(revocations),
  deleteRevocation: (id: string) =>
    Effect.sync(() => {
      const idx = revocations.findIndex((r) => r.id === id)
      if (idx >= 0) revocations.splice(idx, 1)
    }),
  findRevocationByEmail: () => Effect.succeed(null),
} as any)

const mockUserManager = Layer.succeed(UserManager, {
  getUsers: Effect.succeed([]),
  getGroups: Effect.succeed([]),
  createUser: () => Effect.succeed("uid-1"),
  setPassword: () => Effect.void,
  addToGroup: () => Effect.void,
  deleteUser: () => Effect.void,
} as any)

const mockEmailService = Layer.succeed(EmailService, {
  sendInvite: () => Effect.void,
  sendCertRenewal: () => Effect.void,
} as any)

const mockPreferencesRepo = Layer.succeed(PreferencesRepo, {
  getLocale: () => Effect.succeed("en"),
  setLocale: () => Effect.void,
  getLastCertRenewal: () => Effect.succeed({ at: null, renewalId: null }),
  setCertRenewal: () => Effect.void,
  clearCertRenewalId: () => Effect.void,
} as any)

const TestLayer = Layer.mergeAll(
  mockCertManager,
  mockCertRepo(),
  mockInviteRepo,
  mockUserManager,
  mockEmailService,
  mockPreferencesRepo,
)

// --- Parser tests ---

describe("parseAdminUsersMutation", () => {
  it("parses revokeUser", () => {
    const fd = new FormData()
    fd.append("intent", "revokeUser")
    fd.append("username", "alice")
    fd.append("email", "alice@example.com")
    fd.append("reason", "left the team")

    const result = parseAdminUsersMutation(fd)
    expect(result).toEqual({
      intent: "revokeUser",
      username: "alice",
      email: "alice@example.com",
      reason: "left the team",
    })
  })

  it("returns error for missing username on revokeUser", () => {
    const fd = new FormData()
    fd.append("intent", "revokeUser")
    fd.append("email", "alice@example.com")

    const result = parseAdminUsersMutation(fd)
    expect(result).toEqual({ error: "Missing username or email" })
  })

  it("parses revokeCert", () => {
    const fd = new FormData()
    fd.append("intent", "revokeCert")
    fd.append("serialNumber", "abc123")

    const result = parseAdminUsersMutation(fd)
    expect(result).toEqual({ intent: "revokeCert", serialNumber: "abc123" })
  })

  it("returns error for unknown intent", () => {
    const fd = new FormData()
    fd.append("intent", "doSomethingWeird")

    const result = parseAdminUsersMutation(fd)
    expect(result).toEqual({ error: "Unknown action" })
  })
})

// --- Dispatcher tests ---

describe("handleAdminUsersMutation", () => {
  it("revokeCert returns certRevoked for valid serial", async () => {
    const certs = new Map<string, UserCertificate>()
    certs.set("sn-1", {
      id: "1",
      inviteId: null,
      userId: null,
      username: "alice",
      email: "alice@example.com",
      serialNumber: "sn-1",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      revokedAt: null,
      revokeState: null,
      revokeError: null,
    })

    const layer = Layer.mergeAll(
      mockCertManager,
      mockCertRepo(certs),
      mockInviteRepo,
      mockUserManager,
      mockEmailService,
      mockPreferencesRepo,
    )

    const mutation: AdminUsersMutation = { intent: "revokeCert", serialNumber: "sn-1" }
    const result = await Effect.runPromise(handleAdminUsersMutation(mutation).pipe(Effect.provide(layer)))
    expect(result).toEqual({ certRevoked: true, serialNumber: "sn-1" })
  })

  it("revokeCert returns error for non-existent serial", async () => {
    const mutation: AdminUsersMutation = { intent: "revokeCert", serialNumber: "nonexistent" }
    const result = await Effect.runPromise(handleAdminUsersMutation(mutation).pipe(Effect.provide(TestLayer)))
    expect(result).toEqual({ error: "Certificate not found or already revoked" })
  })

  it("reinviteRevoked clears revocation", async () => {
    // Seed a revocation
    revocations.length = 0
    revocations.push({
      id: "rev-1",
      email: "bob@example.com",
      username: "bob",
      reason: "test",
      revokedAt: new Date().toISOString(),
      revokedBy: "admin",
    })

    const mutation: AdminUsersMutation = { intent: "reinviteRevoked", revocationId: "rev-1" }
    const result = await Effect.runPromise(handleAdminUsersMutation(mutation).pipe(Effect.provide(TestLayer)))
    expect(result).toMatchObject({ success: true, reinviteEmail: "bob@example.com" })
    expect(revocations).toHaveLength(0)
  })

  it("reinviteRevoked returns error for unknown revocation", async () => {
    revocations.length = 0

    const mutation: AdminUsersMutation = { intent: "reinviteRevoked", revocationId: "doesnt-exist" }
    const result = await Effect.runPromise(handleAdminUsersMutation(mutation).pipe(Effect.provide(TestLayer)))
    expect(result).toEqual({ error: "Revocation not found" })
  })
})
