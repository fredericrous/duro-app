import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { queueInvite, acceptInvite, revokeInvite, revokeUser, resendCert } from "./invite.server"
import { InviteRepo, InviteError, type Invite, type Revocation } from "~/lib/services/InviteRepo.server"
import { UserManager, UserManagerError } from "~/lib/services/UserManager.server"
import { CertManager } from "~/lib/services/CertManager.server"
import { EmailService, EmailError } from "~/lib/services/EmailService.server"
import { PreferencesRepo } from "~/lib/services/PreferencesRepo.server"

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
        const invite = makeInvite({
          id,
          token,
          email: input.email,
          groups: JSON.stringify(input.groups),
          groupNames: JSON.stringify(input.groupNames),
          invitedBy: input.invitedBy,
        })
        store.set(id, invite)
        return { id, token }
      }),
    findById: (id) => Effect.sync(() => store.get(id) ?? null),
    findByTokenHash: (_hash) => Effect.sync(() => null),
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

const mockUserManager = (calls: { method: string; args: unknown[] }[] = []) =>
  Layer.succeed(UserManager, {
    getUsers: Effect.succeed([]),
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
      return Effect.succeed({ p12Buffer: Buffer.from("fake"), password: "pass" })
    },
    getP12Password: () => Effect.succeed("pass"),
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
  })

const mockEmailService = (calls: { method: string; args: unknown[] }[] = []) =>
  Layer.succeed(EmailService, {
    sendInviteEmail: (email, token, invitedBy, p12Buffer, locale) => {
      calls.push({ method: "sendInviteEmail", args: [email, token, invitedBy, p12Buffer, locale] })
      return Effect.void
    },
    sendCertRenewalEmail: (email, p12Buffer, locale) => {
      calls.push({ method: "sendCertRenewalEmail", args: [email, p12Buffer, locale] })
      return Effect.void
    },
  })

const mockPreferencesRepo = () =>
  Layer.succeed(PreferencesRepo, {
    getLocale: () => Effect.succeed("en"),
    setLocale: () => Effect.void,
  })

// --- Tests ---

describe("queueInvite", () => {
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
      Effect.provide(Layer.mergeAll(mockInviteRepo(store), mockCertManager(certCalls), mockEmailService(emailCalls))),
    )
  })

  it.effect("marks invite as failed when email sending fails", () => {
    const store = new Map<string, Invite>()
    const certCalls: { method: string; args: unknown[] }[] = []

    const failingEmail = Layer.succeed(EmailService, {
      sendInviteEmail: () => Effect.fail(new EmailError({ message: "SMTP down" })),
      sendCertRenewalEmail: () => Effect.void,
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
      Effect.provide(Layer.mergeAll(mockInviteRepo(store), mockCertManager(certCalls), failingEmail)),
    )
  })
})

describe("acceptInvite", () => {
  it.effect("consumes the invite, creates user, sets password, and adds to groups", () => {
    const store = new Map<string, Invite>()
    store.set("inv-1", makeInvite())
    const userCalls: { method: string; args: unknown[] }[] = []
    const certCalls: { method: string; args: unknown[] }[] = []

    const layer = Layer.mergeAll(mockInviteRepo(store), mockUserManager(userCalls), mockCertManager(certCalls))

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
      Effect.provide(Layer.mergeAll(mockInviteRepo(store), mockCertManager(certCalls))),
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
      Effect.provide(Layer.mergeAll(mockInviteRepo(store), mockCertManager(certCalls))),
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
        Layer.mergeAll(mockInviteRepo(new Map(), revocations), mockUserManager(userCalls), mockCertManager(certCalls)),
      ),
    )
  })
})

describe("resendCert", () => {
  it.effect("issues a fresh cert and sends renewal email", () => {
    const certCalls: { method: string; args: unknown[] }[] = []
    const emailCalls: { method: string; args: unknown[] }[] = []

    return resendCert("alice@example.com", "alice").pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.success).toBe(true)
          expect(result.message).toContain("alice@example.com")

          // Cert issued
          const issueCall = certCalls.find((c) => c.method === "issueCertAndP12")
          expect(issueCall).toBeDefined()
          expect(issueCall!.args[0]).toBe("alice@example.com")

          // Renewal email sent
          expect(
            emailCalls.find((c) => c.method === "sendCertRenewalEmail" && c.args[0] === "alice@example.com"),
          ).toBeDefined()

          // Temp secret cleaned up
          expect(certCalls.find((c) => c.method === "deleteP12Secret")).toBeDefined()
        }),
      ),
      Effect.provide(Layer.mergeAll(mockCertManager(certCalls), mockEmailService(emailCalls), mockPreferencesRepo())),
    )
  })
})
