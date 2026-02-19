import { describe, expect, vi } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { queueInvite, acceptInvite } from "./invite.server"
import {
  InviteRepo,
  InviteError,
  type Invite,
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
    ...overrides,
  }
}

// --- Mock Layers ---

const mockInviteRepo = (store: Map<string, Invite> = new Map()) =>
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

const mockVaultPki = Layer.succeed(VaultPki, {
  issueCertAndP12: () => Effect.succeed({ p12Buffer: Buffer.from("fake"), password: "pass" }),
  getP12Password: () => Effect.succeed("pass"),
  consumeP12Password: () => Effect.succeed("pass"),
  deleteP12Secret: () => Effect.void,
  checkCertProcessed: () => Effect.succeed(false),
})

const mockGitHubClient = Layer.succeed(GitHubClient, {
  createCertPR: () => Effect.succeed({ prUrl: "https://github.com/pr/1", prNumber: 1, certUsername: "alice" }),
  checkPRMerged: () => Effect.succeed(false),
  mergePR: () => Effect.void,
  checkWebhookSecret: () => Effect.succeed(false),
})

const mockEmailService = Layer.succeed(EmailService, {
  sendInviteEmail: () => Effect.void,
})

// --- Tests ---

describe("queueInvite", () => {
  it.effect("creates an invite, issues cert, and creates PR", () => {
    const store = new Map<string, Invite>()

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
        Layer.mergeAll(mockInviteRepo(store), mockVaultPki, mockGitHubClient),
      ),
    )
  })

  it.effect("continues even if PR creation fails", () => {
    const store = new Map<string, Invite>()

    const failingGitHub = Layer.succeed(GitHubClient, {
      createCertPR: () => Effect.fail(new GitHubError({ message: "GitHub down" })),
      checkPRMerged: () => Effect.succeed(false),
      mergePR: () => Effect.void,
      checkWebhookSecret: () => Effect.succeed(false),
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
        Layer.mergeAll(mockInviteRepo(store), mockVaultPki, failingGitHub),
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

    const emailLayer = Layer.succeed(EmailService, { sendInviteEmail })
    const ghLayer = Layer.succeed(GitHubClient, {
      createCertPR: () => Effect.succeed({ prUrl: "", prNumber: 0, certUsername: "" }),
      checkPRMerged: () => Effect.succeed(false),
      mergePR,
      checkWebhookSecret: () => Effect.succeed(false),
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
        Layer.mergeAll(mockInviteRepo(store), mockVaultPki, ghLayer, emailLayer),
      ),
    )
  })

  it.effect("skips invite when merge fails", () => {
    const sendInviteEmail = vi.fn(() => Effect.void)
    const store = new Map<string, Invite>()
    store.set("inv-1", makeInvite({ prCreated: true, prNumber: 42 }))

    const emailLayer = Layer.succeed(EmailService, { sendInviteEmail })
    const ghLayer = Layer.succeed(GitHubClient, {
      createCertPR: () => Effect.succeed({ prUrl: "", prNumber: 0, certUsername: "" }),
      checkPRMerged: () => Effect.succeed(false),
      mergePR: () => Effect.fail(new GitHubError({ message: "checks pending" })),
      checkWebhookSecret: () => Effect.succeed(false),
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
        Layer.mergeAll(mockInviteRepo(store), mockVaultPki, ghLayer, emailLayer),
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

      const layer = Layer.mergeAll(
        mockInviteRepo(store),
        mockLldapClient(lldapCalls),
        mockVaultPki,
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
      mockVaultPki,
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
