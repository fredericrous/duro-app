import { describe, expect, vi } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { queueInvite, acceptInvite, revokeInvite, revokeUser, resendCert } from "./invite.server"
import {
  InviteRepo,
  InviteError,
  type Invite,
  type Revocation,
} from "~/lib/services/InviteRepo.server"
import {
  LldapClient,
  LldapError,
} from "~/lib/services/LldapClient.server"
import { VaultPki } from "~/lib/services/VaultPki.server"
import { GitHubClient, GitHubError } from "~/lib/services/GitHubClient.server"
import { EmailService } from "~/lib/services/EmailService.server"

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
    ...overrides,
  }
}

// --- Mock Layers ---

const mockInviteRepo = (
  store: Map<string, Invite> = new Map(),
  revocations: Revocation[] = [],
) =>
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
        [...store.values()].filter((i) => i.prCreated && !i.emailSent && i.prNumber != null && !i.usedAt && !i.failedAt),
      ),
    revoke: () => Effect.void,
    deleteById: (id) =>
      Effect.sync(() => {
        store.delete(id)
      }),
    recordReconcileError: (id, error) =>
      Effect.sync(() => {
        const invite = store.get(id)
        if (invite) store.set(id, { ...invite, reconcileAttempts: invite.reconcileAttempts + 1, lastReconcileAt: new Date().toISOString(), lastError: error })
      }),
    markFailed: (id, error) =>
      Effect.sync(() => {
        const invite = store.get(id)
        if (invite) store.set(id, { ...invite, failedAt: new Date().toISOString(), lastError: error })
      }),
    clearReconcileError: (id) =>
      Effect.sync(() => {
        const invite = store.get(id)
        if (invite) store.set(id, { ...invite, reconcileAttempts: 0, lastReconcileAt: null, lastError: null, failedAt: null })
      }),
    findFailed: () =>
      Effect.sync(() =>
        [...store.values()].filter((i) => i.failedAt != null && !i.usedAt),
      ),
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
        [...store.values()].filter((i) => i.emailSent && !i.certVerified && i.certUsername != null && !i.usedAt && !i.failedAt),
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
    findRevocationByEmail: (email) =>
      Effect.sync(() => revocations.find((r) => r.email === email) ?? null),
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

const mockLldapClient = (
  calls: { method: string; args: unknown[] }[] = [],
) =>
  Layer.succeed(LldapClient, {
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

const mockVaultPki = (calls: { method: string; args: unknown[] }[] = []) =>
  Layer.succeed(VaultPki, {
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

const mockGitHubClient = (calls: { method: string; args: unknown[] }[] = []) =>
  Layer.succeed(GitHubClient, {
    createCertPR: () => Effect.succeed({ prUrl: "https://github.com/pr/1", prNumber: 1, certUsername: "alice" }),
    checkPRMerged: () => Effect.succeed(false),
    mergePR: () => Effect.void,
    checkWebhookSecret: () => Effect.succeed(false),
    closePR: (prNumber) => {
      calls.push({ method: "closePR", args: [prNumber] })
      return Effect.void
    },
    deleteBranch: (inviteId) => {
      calls.push({ method: "deleteBranch", args: [inviteId] })
      return Effect.void
    },
    revertCertFile: (username, email) => {
      calls.push({ method: "revertCertFile", args: [username, email] })
      return Effect.succeed({ prNumber: 99 })
    },
  })

const mockEmailService = (calls: { method: string; args: unknown[] }[] = []) =>
  Layer.succeed(EmailService, {
    sendInviteEmail: () => Effect.void,
    sendCertRenewalEmail: (email, p12Buffer) => {
      calls.push({ method: "sendCertRenewalEmail", args: [email, p12Buffer] })
      return Effect.void
    },
  })

// --- Tests ---

describe("queueInvite", () => {
  it.effect("creates an invite, issues cert, and creates PR", () => {
    const store = new Map<string, Invite>()
    const vaultCalls: { method: string; args: unknown[] }[] = []

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
          expect(invite.prCreated).toBe(true)
          expect(invite.prNumber).toBe(1)
          expect(invite.certUsername).toBe("alice")
        }),
      ),
      Effect.provide(
        Layer.mergeAll(mockInviteRepo(store), mockVaultPki(vaultCalls), mockGitHubClient()),
      ),
    )
  })

  it.effect("continues even if PR creation fails", () => {
    const store = new Map<string, Invite>()
    const vaultCalls: { method: string; args: unknown[] }[] = []

    const failingGitHub = Layer.succeed(GitHubClient, {
      createCertPR: () => Effect.fail(new GitHubError({ message: "GitHub down" })),
      checkPRMerged: () => Effect.succeed(false),
      mergePR: () => Effect.void,
      checkWebhookSecret: () => Effect.succeed(false),
      closePR: () => Effect.void,
      deleteBranch: () => Effect.void,
      revertCertFile: () => Effect.succeed({ prNumber: 0 }),
    })

    return queueInvite({
      email: "alice@example.com",
      groups: [1, 2],
      groupNames: ["friends", "family"],
      invitedBy: "admin",
    }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.success).toBe(true)

          const invite = [...store.values()][0]
          expect(invite.certIssued).toBe(true)
          // PR not created due to failure
          expect(invite.prCreated).toBe(false)
        }),
      ),
      Effect.provide(
        Layer.mergeAll(mockInviteRepo(store), mockVaultPki(vaultCalls), failingGitHub),
      ),
    )
  })
})

describe("reconciler logic", () => {
  it.effect("auto-merges PR and sends email", () => {
    const sendInviteEmail = vi.fn(() => Effect.void)
    const mergePR = vi.fn(() => Effect.void)
    const store = new Map<string, Invite>()
    store.set("inv-1", makeInvite({ prCreated: true, prNumber: 42, certIssued: true }))
    const vaultCalls: { method: string; args: unknown[] }[] = []

    const emailLayer = Layer.succeed(EmailService, {
      sendInviteEmail,
      sendCertRenewalEmail: () => Effect.void,
    })
    const ghLayer = Layer.succeed(GitHubClient, {
      createCertPR: () => Effect.succeed({ prUrl: "", prNumber: 0, certUsername: "" }),
      checkPRMerged: () => Effect.succeed(false),
      mergePR,
      checkWebhookSecret: () => Effect.succeed(false),
      closePR: () => Effect.void,
      deleteBranch: () => Effect.void,
      revertCertFile: () => Effect.succeed({ prNumber: 0 }),
    })

    // Inline reconcile logic for testing (one cycle)
    const reconcileOnce = Effect.gen(function* () {
      const inviteRepo = yield* InviteRepo
      const github = yield* GitHubClient
      const vault = yield* VaultPki
      const emailSvc = yield* EmailService

      const pending = yield* inviteRepo.findAwaitingMerge()

      for (const invite of pending) {
        let merged = yield* github.checkPRMerged(invite.prNumber!).pipe(
          Effect.catchAll(() => Effect.succeed(false)),
        )

        if (!merged) {
          merged = yield* github.mergePR(invite.prNumber!).pipe(
            Effect.map(() => true),
            Effect.catchAll(() => Effect.succeed(false)),
          )
        }

        if (!merged) continue

        yield* inviteRepo.markPRMerged(invite.id)

        const { p12Buffer } = yield* vault.issueCertAndP12(invite.email, invite.id)
        yield* emailSvc.sendInviteEmail(invite.email, invite.token, invite.invitedBy, p12Buffer)
        yield* inviteRepo.markEmailSent(invite.id)
      }
    })

    return reconcileOnce.pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          expect(mergePR).toHaveBeenCalledWith(42)
          expect(sendInviteEmail).toHaveBeenCalledWith(
            "alice@example.com",
            "tok-inv-1",
            "admin",
            Buffer.from("fake"),
          )

          const invite = store.get("inv-1")!
          expect(invite.prMerged).toBe(true)
          expect(invite.emailSent).toBe(true)
        }),
      ),
      Effect.provide(
        Layer.mergeAll(mockInviteRepo(store), mockVaultPki(vaultCalls), ghLayer, emailLayer),
      ),
    )
  })

  it.effect("skips invite when merge fails", () => {
    const sendInviteEmail = vi.fn(() => Effect.void)
    const store = new Map<string, Invite>()
    store.set("inv-1", makeInvite({ prCreated: true, prNumber: 42 }))
    const vaultCalls: { method: string; args: unknown[] }[] = []

    const emailLayer = Layer.succeed(EmailService, {
      sendInviteEmail,
      sendCertRenewalEmail: () => Effect.void,
    })
    const ghLayer = Layer.succeed(GitHubClient, {
      createCertPR: () => Effect.succeed({ prUrl: "", prNumber: 0, certUsername: "" }),
      checkPRMerged: () => Effect.succeed(false),
      mergePR: () => Effect.fail(new GitHubError({ message: "checks pending" })),
      checkWebhookSecret: () => Effect.succeed(false),
      closePR: () => Effect.void,
      deleteBranch: () => Effect.void,
      revertCertFile: () => Effect.succeed({ prNumber: 0 }),
    })

    const reconcileOnce = Effect.gen(function* () {
      const inviteRepo = yield* InviteRepo
      const github = yield* GitHubClient

      const pending = yield* inviteRepo.findAwaitingMerge()

      for (const invite of pending) {
        let merged = yield* github.checkPRMerged(invite.prNumber!).pipe(
          Effect.catchAll(() => Effect.succeed(false)),
        )

        if (!merged) {
          merged = yield* github.mergePR(invite.prNumber!).pipe(
            Effect.map(() => true),
            Effect.catchAll(() => Effect.succeed(false)),
          )
        }

        if (!merged) continue

        yield* inviteRepo.markEmailSent(invite.id)
      }
    })

    return reconcileOnce.pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          expect(sendInviteEmail).not.toHaveBeenCalled()
          expect(store.get("inv-1")!.emailSent).toBe(false)
        }),
      ),
      Effect.provide(
        Layer.mergeAll(mockInviteRepo(store), mockVaultPki(vaultCalls), ghLayer, emailLayer),
      ),
    )
  })
})

describe("acceptInvite", () => {
  it.effect(
    "consumes the invite, creates LLDAP user, sets password, and adds to groups",
    () => {
      const store = new Map<string, Invite>()
      store.set("inv-1", makeInvite())
      const lldapCalls: { method: string; args: unknown[] }[] = []
      const vaultCalls: { method: string; args: unknown[] }[] = []

      const layer = Layer.mergeAll(
        mockInviteRepo(store),
        mockLldapClient(lldapCalls),
        mockVaultPki(vaultCalls),
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

            // LLDAP calls in order: createUser, setUserPassword, addUserToGroup x2
            expect(lldapCalls).toHaveLength(4)
            expect(lldapCalls[0].method).toBe("createUser")
            expect(lldapCalls[1].method).toBe("setUserPassword")
            expect(lldapCalls[1].args).toEqual(["alice", "s3cret"])
            expect(lldapCalls[2].method).toBe("addUserToGroup")
            expect(lldapCalls[2].args).toEqual(["alice", 1])
            expect(lldapCalls[3].method).toBe("addUserToGroup")
            expect(lldapCalls[3].args).toEqual(["alice", 2])
          }),
        ),
        Effect.provide(layer),
      )
    },
  )

  it.effect("rolls back LLDAP user when setUserPassword fails", () => {
    const store = new Map<string, Invite>()
    store.set("inv-1", makeInvite())
    const lldapCalls: { method: string; args: unknown[] }[] = []
    const vaultCalls: { method: string; args: unknown[] }[] = []

    const layer = Layer.mergeAll(
      mockInviteRepo(store),
      Layer.succeed(LldapClient, {
        getUsers: Effect.succeed([]),
        getGroups: Effect.succeed([]),
        createUser: (input) =>
          Effect.sync(() => {
            lldapCalls.push({ method: "createUser", args: [input] })
          }),
        setUserPassword: () =>
          Effect.fail(
            new LldapError({ message: "password policy violation" }),
          ),
        addUserToGroup: () => Effect.void,
        deleteUser: (userId) =>
          Effect.sync(() => {
            lldapCalls.push({ method: "deleteUser", args: [userId] })
          }),
      }),
      mockVaultPki(vaultCalls),
    )

    return acceptInvite("tok-inv-1", {
      username: "alice",
      password: "weak",
    }).pipe(
      Effect.flip,
      Effect.tap((error) =>
        Effect.sync(() => {
          expect(error).toBeInstanceOf(LldapError)
          // User should have been rolled back
          const deleteCall = lldapCalls.find((c) => c.method === "deleteUser")
          expect(deleteCall).toBeDefined()
          expect(deleteCall!.args).toEqual(["alice"])
        }),
      ),
      Effect.provide(layer),
    )
  })
})

describe("revokeInvite", () => {
  it.effect("cleans up Vault, closes PR, and deletes branch for unmerged invite", () => {
    const store = new Map<string, Invite>()
    store.set("inv-1", makeInvite({
      certIssued: true,
      certUsername: "alice",
      prCreated: true,
      prNumber: 42,
      prMerged: false,
    }))
    const vaultCalls: { method: string; args: unknown[] }[] = []
    const ghCalls: { method: string; args: unknown[] }[] = []

    return revokeInvite("inv-1").pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          // Vault cleanup
          expect(vaultCalls.find((c) => c.method === "deleteP12Secret")).toBeDefined()
          expect(vaultCalls.find((c) => c.method === "deleteCertByUsername" && c.args[0] === "alice")).toBeDefined()

          // PR closed and branch deleted
          expect(ghCalls.find((c) => c.method === "closePR" && c.args[0] === 42)).toBeDefined()
          expect(ghCalls.find((c) => c.method === "deleteBranch" && c.args[0] === "inv-1")).toBeDefined()

          // No revertCertFile since PR not merged
          expect(ghCalls.find((c) => c.method === "revertCertFile")).toBeUndefined()
        }),
      ),
      Effect.provide(
        Layer.mergeAll(mockInviteRepo(store), mockVaultPki(vaultCalls), mockGitHubClient(ghCalls)),
      ),
    )
  })

  it.effect("creates revert PR and marks as revoking when PR was already merged", () => {
    const store = new Map<string, Invite>()
    store.set("inv-1", makeInvite({
      certIssued: true,
      certUsername: "alice",
      prCreated: true,
      prNumber: 42,
      prMerged: true,
    }))
    const vaultCalls: { method: string; args: unknown[] }[] = []
    const ghCalls: { method: string; args: unknown[] }[] = []

    return revokeInvite("inv-1").pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          // Should NOT close PR (already merged)
          expect(ghCalls.find((c) => c.method === "closePR")).toBeUndefined()

          // Should revert cert file
          expect(ghCalls.find((c) => c.method === "revertCertFile" && c.args[0] === "alice")).toBeDefined()

          // Should be in revoking state, not revoked — worker will finalize
          const invite = store.get("inv-1")!
          expect(invite.usedBy).toBe("__revoking__")
          expect(invite.revertPrNumber).toBe(99) // from mock
        }),
      ),
      Effect.provide(
        Layer.mergeAll(mockInviteRepo(store), mockVaultPki(vaultCalls), mockGitHubClient(ghCalls)),
      ),
    )
  })
})

describe("revokeUser", () => {
  it.effect("deletes LLDAP user, cleans up Vault, reverts cert, and records revocation", () => {
    const lldapCalls: { method: string; args: unknown[] }[] = []
    const vaultCalls: { method: string; args: unknown[] }[] = []
    const ghCalls: { method: string; args: unknown[] }[] = []
    const revocations: Revocation[] = []

    return revokeUser("alice", "alice@example.com", "admin", "No longer needed").pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          // LLDAP user deleted
          expect(lldapCalls.find((c) => c.method === "deleteUser" && c.args[0] === "alice")).toBeDefined()

          // Vault cert secret cleaned up
          expect(vaultCalls.find((c) => c.method === "deleteCertByUsername" && c.args[0] === "alice")).toBeDefined()

          // Cert file revert PR
          expect(ghCalls.find((c) => c.method === "revertCertFile" && c.args[0] === "alice")).toBeDefined()

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
          mockLldapClient(lldapCalls),
          mockVaultPki(vaultCalls),
          mockGitHubClient(ghCalls),
        ),
      ),
    )
  })
})

describe("resendCert", () => {
  it.effect("issues a fresh cert and sends renewal email", () => {
    const vaultCalls: { method: string; args: unknown[] }[] = []
    const emailCalls: { method: string; args: unknown[] }[] = []

    return resendCert("alice@example.com", "alice").pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.success).toBe(true)
          expect(result.message).toContain("alice@example.com")

          // Cert issued
          const issueCall = vaultCalls.find((c) => c.method === "issueCertAndP12")
          expect(issueCall).toBeDefined()
          expect(issueCall!.args[0]).toBe("alice@example.com")

          // Renewal email sent
          expect(emailCalls.find((c) => c.method === "sendCertRenewalEmail" && c.args[0] === "alice@example.com")).toBeDefined()

          // Temp secret cleaned up
          expect(vaultCalls.find((c) => c.method === "deleteP12Secret")).toBeDefined()
        }),
      ),
      Effect.provide(
        Layer.mergeAll(mockVaultPki(vaultCalls), mockEmailService(emailCalls)),
      ),
    )
  })
})
