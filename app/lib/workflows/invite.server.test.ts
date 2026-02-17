import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { WorkflowEngine } from "@effect/workflow"
import { queueInvite, acceptInvite, InviteWorkflowLayer } from "./invite.server"
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
import { GitHubClient } from "~/lib/services/GitHubClient.server"
import { EmailService } from "~/lib/services/EmailService.server"

// --- Mock helpers ---

function makeInvite(overrides: Partial<Invite> = {}): Invite {
  return {
    id: "inv-1",
    tokenHash: "abc123",
    email: "alice@example.com",
    groups: JSON.stringify([1, 2]),
    groupNames: JSON.stringify(["friends", "family"]),
    invitedBy: "admin",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    usedAt: null,
    usedBy: null,
    stepState: "{}",
    attempts: 0,
    lastAttemptAt: null,
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
    updateStepState: (id, patch) =>
      Effect.sync(() => {
        const invite = store.get(id)
        if (invite) {
          const current = JSON.parse(invite.stepState)
          store.set(id, {
            ...invite,
            stepState: JSON.stringify({ ...current, ...patch }),
          })
        }
      }),
    revoke: () => Effect.void,
    deleteById: (id) =>
      Effect.sync(() => {
        store.delete(id)
      }),
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
})

const mockGitHubClient = Layer.succeed(GitHubClient, {
  createCertPR: () => Effect.succeed({ prUrl: "https://github.com/pr/1" }),
})

const mockEmailService = Layer.succeed(EmailService, {
  sendInviteEmail: () => Effect.void,
})

// Full layer needed for queueInvite (workflow runs in-process)
const makeQueueLayer = (store: Map<string, Invite>) =>
  InviteWorkflowLayer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        mockInviteRepo(store),
        mockVaultPki,
        mockGitHubClient,
        mockEmailService,
        WorkflowEngine.layerMemory,
      ),
    ),
  )

// --- Tests ---

describe("queueInvite", () => {
  it.effect("creates an invite and returns success", () => {
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
        }),
      ),
      Effect.provide(makeQueueLayer(store)),
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

      const layer = Layer.merge(
        mockInviteRepo(store),
        mockLldapClient(lldapCalls),
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

    const layer = Layer.merge(
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
