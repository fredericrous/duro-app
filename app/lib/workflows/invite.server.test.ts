// @vitest-environment node
import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { queueInvite, acceptInvite, revokeInvite, revokeUser, resendCert } from "./invite.server"
import { InviteRepo, InviteError, type Invite, type Revocation } from "~/lib/services/InviteRepo.server"
import { UserManager, UserManagerError, type ManagedUser } from "~/lib/services/UserManager.server"
import { CertManager } from "~/lib/services/CertManager.server"
import { EmailService, EmailError } from "~/lib/services/EmailService.server"
import { PreferencesRepo } from "~/lib/services/PreferencesRepo.server"
import { CertificateRepo } from "~/lib/services/CertificateRepo.server"
import { CertRevealRepo } from "~/lib/services/CertRevealRepo.server"
import { AuditService } from "~/lib/governance/AuditService.server"

const mockAudit = Layer.succeed(AuditService, {
  emit: () => Effect.void,
  query: () => Effect.succeed([]),
} as any)

// --- Mock helpers ---

function makeInvite(overrides: Partial<Invite> = {}): Invite {
  return {
    id: "inv-1",
    token: "tok-inv-1",
    tokenHash: "abc123",
    email: "alice@example.com",
    groups: JSON.stringify([1, 2]),
    groupNames: JSON.stringify(["friends", "family"]),
    invitedBy: "admin",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    usedAt: null,
    usedBy: null,
    certIssued: false,
    prCreated: false,
    prNumber: null,
    prMerged: false,
    emailSent: false,
    attempts: 0,
    lastAttemptAt: null,
    reconcileAttempts: 0,
    lastReconcileAt: null,
    lastError: null,
    failedAt: null,
    certUsername: null,
    certVerified: false,
    certVerifiedAt: null,
    revertPrNumber: null,
    revertPrMerged: false,
    locale: "en",
    openToken: "open-inv-1",
    firstOpenedAt: null,
    lastOpenedAt: null,
    openCount: 0,
    lastOpenUserAgent: null,
    firstClickedAt: null,
    lastClickedAt: null,
    clickCount: 0,
    lastClickUserAgent: null,
    messageId: null,
    deliveryStatus: null,
    deliveredAt: null,
    bouncedAt: null,
    lastDeliveryEventAt: null,
    deliveryDetail: null,
    ...overrides,
  }
}

// --- Mock Layers ---

const mockInviteRepo = (store: Map<string, Invite> = new Map(), revocations: Revocation[] = []) =>
  Layer.succeed(InviteRepo, {
    create: (input) =>
      Effect.sync(() => {
        const id = `inv-${store.size + 1}`
        const token = `tok-${id}`
        const openToken = `open-${id}`
        const invite = makeInvite({
          id,
          token,
          openToken,
          email: input.email,
          groups: JSON.stringify(input.groups),
          groupNames: JSON.stringify(input.groupNames),
          invitedBy: input.invitedBy,
        })
        store.set(id, invite)
        return { id, token, openToken }
      }),
    findById: (id) => Effect.sync(() => store.get(id) ?? null),
    findByTokenHash: (_hash) => Effect.sync(() => null),
    recordOpen: (openToken, userAgent) =>
      Effect.sync(() => {
        const invite = [...store.values()].find((i) => i.openToken === openToken)
        if (invite)
          store.set(invite.id, {
            ...invite,
            firstOpenedAt: invite.firstOpenedAt ?? new Date().toISOString(),
            lastOpenedAt: new Date().toISOString(),
            openCount: invite.openCount + 1,
            lastOpenUserAgent: userAgent,
          })
      }),
    recordClick: (tokenHash, userAgent) =>
      Effect.sync(() => {
        const invite = [...store.values()].find((i) => i.tokenHash === tokenHash)
        if (invite)
          store.set(invite.id, {
            ...invite,
            firstClickedAt: invite.firstClickedAt ?? new Date().toISOString(),
            lastClickedAt: new Date().toISOString(),
            clickCount: invite.clickCount + 1,
            lastClickUserAgent: userAgent,
          })
      }),
    setMessageId: (id, messageId) =>
      Effect.sync(() => {
        const invite = store.get(id)
        if (invite) store.set(id, { ...invite, messageId })
      }),
    findByMessageId: (messageId) =>
      Effect.sync(() => [...store.values()].find((i) => i.messageId === messageId) ?? null),
    findLatestByEmail: (email) =>
      Effect.sync(() => [...store.values()].filter((i) => i.email === email).at(-1) ?? null),
    recordDelivery: (id, input) =>
      Effect.sync(() => {
        const invite = store.get(id)
        if (invite)
          store.set(id, {
            ...invite,
            deliveryStatus: input.status,
            deliveredAt: input.status === "delivered" ? (invite.deliveredAt ?? input.at) : invite.deliveredAt,
            bouncedAt: input.status === "bounced" ? (invite.bouncedAt ?? input.at) : invite.bouncedAt,
            lastDeliveryEventAt: input.at,
            deliveryDetail: input.detail,
          })
      }),
    consumeByToken: (rawToken) =>
      Effect.sync(() => {
        const id = rawToken.replace("tok-", "")
        const invite = store.get(id)
        if (!invite) throw new InviteError({ message: "not found" })
        const consumed = { ...invite, usedAt: new Date().toISOString() }
        store.set(id, consumed)
        return consumed
      }),
    markUsedBy: (id, username) =>
      Effect.sync(() => {
        const invite = store.get(id)
        if (invite) store.set(id, { ...invite, usedBy: username })
      }),
    findPending: () => Effect.sync(() => [...store.values()].filter((i) => !i.usedAt)),
    incrementAttempt: () => Effect.void,
    markCertIssued: (id) =>
      Effect.sync(() => {
        const invite = store.get(id)
        if (invite) store.set(id, { ...invite, certIssued: true })
      }),
    markPRCreated: (id, prNumber) =>
      Effect.sync(() => {
        const invite = store.get(id)
        if (invite) store.set(id, { ...invite, prCreated: true, prNumber })
      }),
    markPRMerged: (id) =>
      Effect.sync(() => {
        const invite = store.get(id)
        if (invite) store.set(id, { ...invite, prMerged: true })
      }),
    markEmailSent: (id) =>
      Effect.sync(() => {
        const invite = store.get(id)
        if (invite) store.set(id, { ...invite, emailSent: true })
      }),
    findAwaitingMerge: () =>
      Effect.sync(() =>
        [...store.values()].filter(
          (i) => i.prCreated && !i.emailSent && i.prNumber != null && !i.usedAt && !i.failedAt,
        ),
      ),
    revoke: () => Effect.void,
    deleteById: (id) =>
      Effect.sync(() => {
        store.delete(id)
      }),
    recordReconcileError: (id, error) =>
      Effect.sync(() => {
        const invite = store.get(id)
        if (invite)
          store.set(id, {
            ...invite,
            reconcileAttempts: invite.reconcileAttempts + 1,
            lastReconcileAt: new Date().toISOString(),
            lastError: error,
          })
      }),
    markFailed: (id, error) =>
      Effect.sync(() => {
        const invite = store.get(id)
        if (invite) store.set(id, { ...invite, failedAt: new Date().toISOString(), lastError: error })
      }),
    clearReconcileError: (id) =>
      Effect.sync(() => {
        const invite = store.get(id)
        if (invite)
          store.set(id, { ...invite, reconcileAttempts: 0, lastReconcileAt: null, lastError: null, failedAt: null })
      }),
    findFailed: () => Effect.sync(() => [...store.values()].filter((i) => i.failedAt != null && !i.usedAt)),
    setCertUsername: (id, username) =>
      Effect.sync(() => {
        const invite = store.get(id)
        if (invite) store.set(id, { ...invite, certUsername: username })
      }),
    markCertVerified: (id) =>
      Effect.sync(() => {
        const invite = store.get(id)
        if (invite) store.set(id, { ...invite, certVerified: true, certVerifiedAt: new Date().toISOString() })
      }),
    findAwaitingCertVerification: () =>
      Effect.sync(() =>
        [...store.values()].filter(
          (i) => i.emailSent && !i.certVerified && i.certUsername != null && !i.usedAt && !i.failedAt,
        ),
      ),
    recordRevocation: (email, username, revokedBy, reason?) =>
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
    findRevocations: () => Effect.sync(() => revocations),
    deleteRevocation: (id) =>
      Effect.sync(() => {
        const idx = revocations.findIndex((r) => r.id === id)
        if (idx >= 0) revocations.splice(idx, 1)
      }),
    findRevocationByEmail: (email) => Effect.sync(() => revocations.find((r) => r.email === email) ?? null),
    markRevoking: (id) =>
      Effect.sync(() => {
        const invite = store.get(id)
        if (invite) store.set(id, { ...invite, usedAt: new Date().toISOString(), usedBy: "__revoking__" })
      }),
    markRevertPRCreated: (id, prNumber) =>
      Effect.sync(() => {
        const invite = store.get(id)
        if (invite) store.set(id, { ...invite, revertPrNumber: prNumber })
      }),
    markRevertPRMerged: (id) =>
      Effect.sync(() => {
        const invite = store.get(id)
        if (invite) store.set(id, { ...invite, revertPrMerged: true, usedBy: "__revoked__" })
      }),
    findAwaitingRevertMerge: () =>
      Effect.sync(() =>
        [...store.values()].filter((i) => i.usedBy === "__revoking__" && i.revertPrNumber != null && !i.revertPrMerged),
      ),
  })

const mockUserManager = (calls: { method: string; args: unknown[] }[] = [], users: ManagedUser[] = []) =>
  Layer.succeed(UserManager, {
    getUsers: Effect.succeed(users),
    getGroups: Effect.succeed([]),
    createUser: (input) =>
      Effect.sync(() => {
        calls.push({ method: "createUser", args: [input] })
      }),
    setUserPassword: (userId, password) =>
      Effect.sync(() => {
        calls.push({ method: "setUserPassword", args: [userId, password] })
      }),
    addUserToGroup: (userId, groupId) =>
      Effect.sync(() => {
        calls.push({ method: "addUserToGroup", args: [userId, groupId] })
      }),
    deleteUser: (userId) =>
      Effect.sync(() => {
        calls.push({ method: "deleteUser", args: [userId] })
      }),
  })

const mockCertManager = (calls: { method: string; args: unknown[] }[] = []) =>
  Layer.succeed(CertManager, {
    issueCertAndP12: (_email, _id) => {
      calls.push({ method: "issueCertAndP12", args: [_email, _id] })
      return Effect.succeed({
        p12Buffer: Buffer.from("fake"),
        password: "pass",
        serialNumber: "aa:bb:cc:dd",
        notAfter: new Date(Date.now() + 90 * 24 * 3600_000),
      })
    },
    getP12Password: () => Effect.succeed("pass"),
    getP12: () => Effect.succeed(Buffer.from("fake")),
    consumeP12Password: () => Effect.succeed("pass"),
    deleteP12Secret: (id) => {
      calls.push({ method: "deleteP12Secret", args: [id] })
      return Effect.void
    },
    checkCertProcessed: () => Effect.succeed(false),
    deleteCertByUsername: (username) => {
      calls.push({ method: "deleteCertByUsername", args: [username] })
      return Effect.void
    },
    revokeCert: (serialNumber) => {
      calls.push({ method: "revokeCert", args: [serialNumber] })
      return Effect.void
    },
  })

const mockCertificateRepo = (calls: { method: string; args: unknown[] }[] = []) =>
  Layer.succeed(CertificateRepo, {
    store: (cert) => {
      calls.push({ method: "store", args: [cert] })
      return Effect.void
    },
    setLabel: (_serial, _username, _label) => Effect.succeed(1),
    listValid: () => Effect.succeed([]),
    listAllByUsernames: () => Effect.succeed({}),
    findBySerial: () => Effect.succeed(null),
    markRevokePending: (_serial, _username?) => {
      calls.push({ method: "markRevokePending", args: [_serial, _username] })
      return Effect.succeed(1)
    },
    markRevokeCompleted: (serial) => {
      calls.push({ method: "markRevokeCompleted", args: [serial] })
      return Effect.void
    },
    markRevokeFailed: (serial, error) => {
      calls.push({ method: "markRevokeFailed", args: [serial, error] })
      return Effect.void
    },
    revokeAllForUser: (_username) => {
      calls.push({ method: "revokeAllForUser", args: [_username] })
      return Effect.succeed([])
    },
    setUserId: (inviteId, userId) => {
      calls.push({ method: "setUserId", args: [inviteId, userId] })
      return Effect.void
    },
    updateUsername: (oldUsername, newUsername) => {
      calls.push({ method: "updateUsername", args: [oldUsername, newUsername] })
      return Effect.void
    },
  })

const mockEmailService = (calls: { method: string; args: unknown[] }[] = []) =>
  Layer.succeed(EmailService, {
    sendInviteEmail: (email, token, invitedBy, locale, _openToken, inviteId) => {
      calls.push({ method: "sendInviteEmail", args: [email, token, invitedBy, locale] })
      return Effect.succeed(`<invite-${inviteId ?? "x"}@test>`)
    },
    sendCertRenewalEmail: (email, locale, revealToken) => {
      calls.push({ method: "sendCertRenewalEmail", args: [email, locale, revealToken] })
      return Effect.void
    },
    sendRecoveryNotificationEmail: () => Effect.void,
    sendNotificationEmail: () => Effect.void,
  })

const mockPreferencesRepo = () =>
  Layer.succeed(PreferencesRepo, {
    getLocale: () => Effect.succeed("en"),
    getStoredLocale: () => Effect.succeed(null),
    setLocale: () => Effect.void,
    getLastCertRenewal: () => Effect.succeed({ at: null, renewalId: null }),
    setCertRenewal: () => Effect.void,
    clearCertRenewalId: () => Effect.void,
  })

const mockCertRevealRepo = (calls: { method: string; args: unknown[] }[] = []) =>
  Layer.succeed(CertRevealRepo, {
    create: (...args) => {
      calls.push({ method: "create", args })
      return Effect.succeed({ id: "reveal-id", token: "reveal-tok" })
    },
    findByTokenHash: (...args) => {
      calls.push({ method: "findByTokenHash", args })
      return Effect.succeed(null)
    },
    markRevealed: (...args) => {
      calls.push({ method: "markRevealed", args })
      return Effect.void
    },
  })

// --- Tests ---

describe("queueInvite", () => {
  it.effect("fully revokes a stale failed invite before re-inviting (cleans up its Vault cert)", () => {
    const store = new Map<string, Invite>()
    // A previous invite for this email that failed after its cert was issued.
    store.set(
      "stale-1",
      makeInvite({
        id: "stale-1",
        email: "alice@example.com",
        certIssued: true,
        certUsername: "alice",
        failedAt: new Date().toISOString(),
      }),
    )
    const certCalls: { method: string; args: unknown[] }[] = []
    const certRepoCalls: { method: string; args: unknown[] }[] = []

    return queueInvite({
      email: "alice@example.com",
      groups: [1],
      groupNames: ["friends"],
      invitedBy: "admin",
    }).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          // The full revokeInvite cleanup ran on the stale invite — not just
          // inviteRepo.revoke (which would orphan the Vault P12 + serial).
          expect(certCalls.find((c) => c.method === "deleteP12Secret" && c.args[0] === "stale-1")).toBeDefined()
          expect(certCalls.find((c) => c.method === "deleteCertByUsername" && c.args[0] === "alice")).toBeDefined()
          expect(certRepoCalls.find((c) => c.method === "revokeAllForUser" && c.args[0] === "alice")).toBeDefined()
        }),
      ),
      Effect.provide(
        Layer.mergeAll(
          mockInviteRepo(store),
          mockCertManager(certCalls),
          mockEmailService(),
          mockCertificateRepo(certRepoCalls),
          mockUserManager(),
          mockPreferencesRepo(),
          mockAudit,
        ),
      ),
    )
  })

  it.effect("creates an invite, issues cert, and sends email", () => {
    const store = new Map<string, Invite>()
    const certCalls: { method: string; args: unknown[] }[] = []
    const emailCalls: { method: string; args: unknown[] }[] = []

    return queueInvite({
      email: "alice@example.com",
      groups: [1, 2],
      groupNames: ["friends", "family"],
      invitedBy: "admin",
    }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.success).toBe(true)
          expect(result.message).toContain("alice@example.com")
          expect(store.size).toBe(1)

          const invite = [...store.values()][0]
          expect(invite.certIssued).toBe(true)
          expect(invite.emailSent).toBe(true)
          expect(invite.certUsername).toBe("alice")

          // Cert issued
          expect(certCalls.find((c) => c.method === "issueCertAndP12")).toBeDefined()

          // Email sent
          const emailCall = emailCalls.find((c) => c.method === "sendInviteEmail")
          expect(emailCall).toBeDefined()
          expect(emailCall!.args[0]).toBe("alice@example.com")
        }),
      ),
      Effect.provide(
        Layer.mergeAll(
          mockInviteRepo(store),
          mockCertManager(certCalls),
          mockEmailService(emailCalls),
          mockCertificateRepo(),
          mockUserManager(),
          mockPreferencesRepo(),
          mockAudit,
        ),
      ),
    )
  })

  it.effect("sends in the recipient's stored locale when one exists (overriding the caller)", () => {
    const store = new Map<string, Invite>()
    const emailCalls: { method: string; args: unknown[] }[] = []
    // The invited email already maps to a user who saved a French preference.
    const existing: ManagedUser = {
      id: "alice",
      email: "alice@example.com",
      displayName: "Alice",
      creationDate: "2026-01-01",
    }
    const prefsFr = Layer.succeed(PreferencesRepo, {
      getLocale: () => Effect.succeed("fr"),
      getStoredLocale: () => Effect.succeed("fr"),
      setLocale: () => Effect.void,
      getLastCertRenewal: () => Effect.succeed({ at: null, renewalId: null }),
      setCertRenewal: () => Effect.void,
      clearCertRenewalId: () => Effect.void,
    })

    return queueInvite({
      email: "alice@example.com",
      groups: [1],
      groupNames: ["friends"],
      invitedBy: "admin",
      locale: "en", // caller asks for English…
    }).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          const call = emailCalls.find((c) => c.method === "sendInviteEmail")
          // …but the stored French preference wins.
          expect(call!.args[3]).toBe("fr")
        }),
      ),
      Effect.provide(
        Layer.mergeAll(
          mockInviteRepo(store),
          mockCertManager(),
          mockEmailService(emailCalls),
          mockCertificateRepo(),
          mockUserManager([], [existing]),
          prefsFr,
          mockAudit,
        ),
      ),
    )
  })

  it.effect("marks invite as failed when email sending fails", () => {
    const store = new Map<string, Invite>()
    const certCalls: { method: string; args: unknown[] }[] = []

    const failingEmail = Layer.succeed(EmailService, {
      sendInviteEmail: () => Effect.fail(new EmailError({ message: "SMTP down" })),
      // (typed as Effect<string>; the failure short-circuits before the value)
      sendCertRenewalEmail: () => Effect.void,
      sendRecoveryNotificationEmail: () => Effect.void,
      sendNotificationEmail: () => Effect.void,
    } as EmailService["Type"])

    return queueInvite({
      email: "alice@example.com",
      groups: [1, 2],
      groupNames: ["friends", "family"],
      invitedBy: "admin",
    }).pipe(
      Effect.flip,
      Effect.tap(() =>
        Effect.sync(() => {
          const invite = [...store.values()][0]
          expect(invite.certIssued).toBe(true)
          expect(invite.emailSent).toBe(false)
          expect(invite.failedAt).not.toBeNull()
          expect(invite.lastError).toBe("SMTP down")
        }),
      ),
      Effect.provide(
        Layer.mergeAll(
          mockInviteRepo(store),
          mockCertManager(certCalls),
          failingEmail,
          mockCertificateRepo(),
          mockUserManager(),
          mockPreferencesRepo(),
          mockAudit,
        ),
      ),
    )
  })
})

describe("acceptInvite", () => {
  it.effect("consumes the invite, creates user, sets password, and adds to groups", () => {
    const store = new Map<string, Invite>()
    store.set("inv-1", makeInvite())
    const userCalls: { method: string; args: unknown[] }[] = []
    const certCalls: { method: string; args: unknown[] }[] = []

    const layer = Layer.mergeAll(
      mockInviteRepo(store),
      mockUserManager(userCalls),
      mockCertManager(certCalls),
      mockCertificateRepo(),
    )

    return acceptInvite("tok-inv-1", {
      username: "alice",
      password: "s3cret",
    }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.success).toBe(true)

          // Invite consumed
          expect(store.get("inv-1")!.usedAt).not.toBeNull()
          expect(store.get("inv-1")!.usedBy).toBe("alice")

          // User management calls in order: createUser, setUserPassword, addUserToGroup x2
          expect(userCalls).toHaveLength(4)
          expect(userCalls[0].method).toBe("createUser")
          expect(userCalls[1].method).toBe("setUserPassword")
          expect(userCalls[1].args).toEqual(["alice", "s3cret"])
          expect(userCalls[2].method).toBe("addUserToGroup")
          expect(userCalls[2].args).toEqual(["alice", 1])
          expect(userCalls[3].method).toBe("addUserToGroup")
          expect(userCalls[3].args).toEqual(["alice", 2])
        }),
      ),
      Effect.provide(layer),
    )
  })

  it.effect("rolls back user when setUserPassword fails", () => {
    const store = new Map<string, Invite>()
    store.set("inv-1", makeInvite())
    const userCalls: { method: string; args: unknown[] }[] = []
    const certCalls: { method: string; args: unknown[] }[] = []

    const layer = Layer.mergeAll(
      mockInviteRepo(store),
      Layer.succeed(UserManager, {
        getUsers: Effect.succeed([]),
        getGroups: Effect.succeed([]),
        createUser: (input) =>
          Effect.sync(() => {
            userCalls.push({ method: "createUser", args: [input] })
          }),
        setUserPassword: () => Effect.fail(new UserManagerError({ message: "password policy violation" })),
        addUserToGroup: () => Effect.void,
        deleteUser: (userId) =>
          Effect.sync(() => {
            userCalls.push({ method: "deleteUser", args: [userId] })
          }),
      }),
      mockCertManager(certCalls),
      mockCertificateRepo(),
    )

    return acceptInvite("tok-inv-1", {
      username: "alice",
      password: "weak",
    }).pipe(
      Effect.flip,
      Effect.tap((error) =>
        Effect.sync(() => {
          expect(error).toBeInstanceOf(UserManagerError)
          // User should have been rolled back
          const deleteCall = userCalls.find((c) => c.method === "deleteUser")
          expect(deleteCall).toBeDefined()
          expect(deleteCall!.args).toEqual(["alice"])
        }),
      ),
      Effect.provide(layer),
    )
  })
})

describe("revokeInvite", () => {
  it.effect("cleans up cert secrets and revokes invite", () => {
    const store = new Map<string, Invite>()
    store.set(
      "inv-1",
      makeInvite({
        certIssued: true,
        certUsername: "alice",
      }),
    )
    const certCalls: { method: string; args: unknown[] }[] = []

    return revokeInvite("inv-1").pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          // Cert cleanup
          expect(certCalls.find((c) => c.method === "deleteP12Secret")).toBeDefined()
          expect(certCalls.find((c) => c.method === "deleteCertByUsername" && c.args[0] === "alice")).toBeDefined()
        }),
      ),
      Effect.provide(
        Layer.mergeAll(mockInviteRepo(store), mockCertManager(certCalls), mockCertificateRepo(), mockAudit),
      ),
    )
  })

  it.effect("derives certUsername from email when not set", () => {
    const store = new Map<string, Invite>()
    store.set(
      "inv-1",
      makeInvite({
        certIssued: true,
        certUsername: null,
        email: "bob.smith@example.com",
      }),
    )
    const certCalls: { method: string; args: unknown[] }[] = []

    return revokeInvite("inv-1").pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          expect(certCalls.find((c) => c.method === "deleteCertByUsername" && c.args[0] === "bobsmith")).toBeDefined()
        }),
      ),
      Effect.provide(
        Layer.mergeAll(mockInviteRepo(store), mockCertManager(certCalls), mockCertificateRepo(), mockAudit),
      ),
    )
  })
})

describe("revokeUser", () => {
  it.effect("deletes user, cleans up cert, and records revocation", () => {
    const userCalls: { method: string; args: unknown[] }[] = []
    const certCalls: { method: string; args: unknown[] }[] = []
    const revocations: Revocation[] = []

    return revokeUser("alice", "alice@example.com", "admin", "No longer needed").pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          // User deleted
          expect(userCalls.find((c) => c.method === "deleteUser" && c.args[0] === "alice")).toBeDefined()

          // Cert secret cleaned up
          expect(certCalls.find((c) => c.method === "deleteCertByUsername" && c.args[0] === "alice")).toBeDefined()

          // Revocation recorded
          expect(revocations).toHaveLength(1)
          expect(revocations[0].email).toBe("alice@example.com")
          expect(revocations[0].username).toBe("alice")
          expect(revocations[0].reason).toBe("No longer needed")
          expect(revocations[0].revokedBy).toBe("admin")
        }),
      ),
      Effect.provide(
        Layer.mergeAll(
          mockInviteRepo(new Map(), revocations),
          mockUserManager(userCalls),
          mockCertManager(certCalls),
          mockCertificateRepo(),
          mockAudit,
        ),
      ),
    )
  })
})

describe("resendCert", () => {
  it.effect("issues a fresh cert, mints a reveal token, and emails the reveal link", () => {
    const certCalls: { method: string; args: unknown[] }[] = []
    const emailCalls: { method: string; args: unknown[] }[] = []
    const revealCalls: { method: string; args: unknown[] }[] = []

    return resendCert("alice@example.com", "alice").pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.success).toBe(true)
          expect(result.message).toContain("alice@example.com")

          // Cert issued
          const issueCall = certCalls.find((c) => c.method === "issueCertAndP12")
          expect(issueCall).toBeDefined()
          expect(issueCall!.args[0]).toBe("alice@example.com")

          // A single-use reveal token was minted for this renewal
          const createCall = revealCalls.find((c) => c.method === "create")
          expect(createCall).toBeDefined()
          const createArg = createCall!.args[0] as { renewalId: string; email: string; username: string }
          expect(createArg.email).toBe("alice@example.com")
          expect(createArg.username).toBe("alice")
          // renewalId is the same id the cert/P12 password is keyed under
          expect(createArg.renewalId).toBe(issueCall!.args[1])

          // Link-only renewal email sent WITH the reveal token (3rd arg) and
          // NO P12 attachment (the buffer is no longer passed to the email).
          const emailCall = emailCalls.find(
            (c) => c.method === "sendCertRenewalEmail" && c.args[0] === "alice@example.com",
          )
          expect(emailCall).toBeDefined()
          expect(emailCall!.args).toHaveLength(3)
          expect(emailCall!.args[2]).toBe("reveal-tok")

          // P12 secret is NOT deleted — it must survive for the reveal page download
          expect(certCalls.find((c) => c.method === "deleteP12Secret")).toBeUndefined()
        }),
      ),
      Effect.provide(
        Layer.mergeAll(
          mockCertManager(certCalls),
          mockEmailService(emailCalls),
          mockPreferencesRepo(),
          mockCertificateRepo(),
          mockCertRevealRepo(revealCalls),
          mockAudit,
        ),
      ),
    )
  })
})

describe("audit emissions", () => {
  it.effect("queueInvite emits a cert.issued audit event", () => {
    const store = new Map<string, Invite>()
    const events: string[] = []
    const capturingAudit = Layer.succeed(AuditService, {
      emit: (e: { eventType: string }) => Effect.sync(() => void events.push(e.eventType)),
      query: () => Effect.succeed([]),
    } as any)

    return queueInvite({
      email: "alice@example.com",
      groups: [1],
      groupNames: ["friends"],
      invitedBy: "admin",
    }).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          expect(events).toContain("cert.issued")
        }),
      ),
      Effect.provide(
        Layer.mergeAll(
          mockInviteRepo(store),
          mockCertManager(),
          mockEmailService(),
          mockCertificateRepo(),
          mockUserManager(),
          mockPreferencesRepo(),
          capturingAudit,
        ),
      ),
    )
  })

  it.effect("revokeUser emits user.revoked and cert.revoked audit events", () => {
    const events: string[] = []
    const capturingAudit = Layer.succeed(AuditService, {
      emit: (e: { eventType: string }) => Effect.sync(() => void events.push(e.eventType)),
      query: () => Effect.succeed([]),
    } as any)
    // A CertificateRepo that returns one active serial so the revoke loop runs
    // and a cert.revoked event is emitted after markRevokeCompleted.
    const certRepoWithSerial = Layer.succeed(CertificateRepo, {
      store: () => Effect.void,
      setLabel: () => Effect.succeed(1),
      listValid: () => Effect.succeed([]),
      listAllByUsernames: () => Effect.succeed({}),
      findBySerial: () => Effect.succeed(null),
      markRevokePending: () => Effect.succeed(1),
      markRevokeCompleted: () => Effect.void,
      markRevokeFailed: () => Effect.void,
      revokeAllForUser: () => Effect.succeed(["serial-1"]),
      setUserId: () => Effect.void,
      updateUsername: () => Effect.void,
    } as any)

    return revokeUser("alice", "alice@example.com", "admin", "cleanup").pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          expect(events).toContain("user.revoked")
          expect(events).toContain("cert.revoked")
        }),
      ),
      Effect.provide(
        Layer.mergeAll(
          mockInviteRepo(new Map()),
          mockUserManager(),
          mockCertManager(),
          certRepoWithSerial,
          capturingAudit,
        ),
      ),
    )
  })
})
