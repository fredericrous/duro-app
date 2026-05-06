import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import {
  submitBootstrapInviteWithCallerToken,
  submitBootstrapInviteAuto,
  __resetMutexForTests,
} from "./bootstrap.server"
import { InviteRepo, type Invite } from "~/lib/services/InviteRepo.server"
import { UserManager } from "~/lib/services/UserManager.server"
import { CertManager } from "~/lib/services/CertManager.server"
import { CertificateRepo } from "~/lib/services/CertificateRepo.server"
import { EmailService, EmailError } from "~/lib/services/EmailService.server"

// ---------------------------------------------------------------------------
// Lightweight mocks (mirroring invite.server.test.ts)
// ---------------------------------------------------------------------------

function makeInvite(overrides: Partial<Invite> = {}): Invite {
  return {
    id: "inv-1",
    token: "tok-inv-1",
    tokenHash: "abc",
    email: "alice@example.com",
    groups: JSON.stringify([1]),
    groupNames: JSON.stringify(["lldap_admin"]),
    invitedBy: "bootstrap",
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

const mockInviteRepo = (store = new Map<string, Invite>()) =>
  Layer.succeed(InviteRepo, {
    create: (input) =>
      Effect.sync(() => {
        const id = `inv-${store.size + 1}`
        const token = `tok-${id}`
        const inv = makeInvite({
          id,
          token,
          email: input.email,
          groups: JSON.stringify(input.groups),
          groupNames: JSON.stringify(input.groupNames),
          invitedBy: input.invitedBy,
        })
        store.set(id, inv)
        return { id, token }
      }),
    findById: (id) => Effect.sync(() => store.get(id) ?? null),
    findByTokenHash: () => Effect.sync(() => null),
    consumeByToken: () => Effect.sync(() => makeInvite()),
    markUsedBy: () => Effect.void,
    findPending: () => Effect.sync(() => [...store.values()].filter((i) => !i.usedAt && !i.failedAt)),
    incrementAttempt: () => Effect.void,
    markCertIssued: (id) =>
      Effect.sync(() => {
        const inv = store.get(id)
        if (inv) store.set(id, { ...inv, certIssued: true })
      }),
    markPRCreated: () => Effect.void,
    markPRMerged: () => Effect.void,
    markEmailSent: (id) =>
      Effect.sync(() => {
        const inv = store.get(id)
        if (inv) store.set(id, { ...inv, emailSent: true })
      }),
    findAwaitingMerge: () => Effect.succeed([]),
    revoke: () => Effect.void,
    deleteById: () => Effect.void,
    recordReconcileError: () => Effect.void,
    markFailed: (id, error) =>
      Effect.sync(() => {
        const inv = store.get(id)
        if (inv) store.set(id, { ...inv, failedAt: new Date().toISOString(), lastError: error })
      }),
    clearReconcileError: () => Effect.void,
    findFailed: () => Effect.sync(() => [...store.values()].filter((i) => i.failedAt != null && !i.usedAt)),
    setCertUsername: (id, username) =>
      Effect.sync(() => {
        const inv = store.get(id)
        if (inv) store.set(id, { ...inv, certUsername: username })
      }),
    markCertVerified: () => Effect.void,
    findAwaitingCertVerification: () => Effect.succeed([]),
    recordRevocation: () => Effect.void,
    findRevocations: () => Effect.succeed([]),
    deleteRevocation: () => Effect.void,
    findRevocationByEmail: () => Effect.succeed(null),
    markRevoking: () => Effect.void,
    markRevertPRCreated: () => Effect.void,
    markRevertPRMerged: () => Effect.void,
    findAwaitingRevertMerge: () => Effect.succeed([]),
  })

const mockUserManager = (
  opts: {
    users?: { id: string; email: string; displayName: string; creationDate: string }[]
    groups?: { id: number; displayName: string }[]
  } = {},
) =>
  Layer.succeed(UserManager, {
    getUsers: Effect.succeed(opts.users ?? []),
    getGroups: Effect.succeed(opts.groups ?? [{ id: 1, displayName: "lldap_admin" }]),
    createUser: () => Effect.void,
    setUserPassword: () => Effect.void,
    addUserToGroup: () => Effect.void,
    deleteUser: () => Effect.void,
  })

const mockCertManager = () =>
  Layer.succeed(CertManager, {
    issueCertAndP12: () =>
      Effect.succeed({
        p12Buffer: Buffer.from("fake"),
        password: "pw",
        serialNumber: "aa:bb",
        notAfter: new Date(Date.now() + 90 * 86400_000),
      }),
    getP12Password: () => Effect.succeed("pw"),
    consumeP12Password: () => Effect.succeed("pw"),
    deleteP12Secret: () => Effect.void,
    checkCertProcessed: () => Effect.succeed(false),
    deleteCertByUsername: () => Effect.void,
    revokeCert: () => Effect.void,
  })

const mockCertificateRepo = () =>
  Layer.succeed(CertificateRepo, {
    store: () => Effect.void,
    listValid: () => Effect.succeed([]),
    listAllByUsernames: () => Effect.succeed({}),
    findBySerial: () => Effect.succeed(null),
    markRevokePending: () => Effect.succeed(1),
    markRevokeCompleted: () => Effect.void,
    markRevokeFailed: () => Effect.void,
    revokeAllForUser: () => Effect.succeed([]),
    setUserId: () => Effect.void,
    updateUsername: () => Effect.void,
  })

const mockEmailService = (sendShouldFail = false) =>
  Layer.succeed(EmailService, {
    sendInviteEmail: () =>
      sendShouldFail ? Effect.fail(new EmailError({ message: "SMTP down" })) : Effect.void,
    sendCertRenewalEmail: () => Effect.void,
  })

type AllLayersOpts = {
  sendShouldFail?: boolean
  users?: { id: string; email: string; displayName: string; creationDate: string }[]
}

const allLayers = (store: Map<string, Invite>, opts: AllLayersOpts = {}) =>
  Layer.mergeAll(
    mockInviteRepo(store),
    mockUserManager({ users: opts.users }),
    mockCertManager(),
    mockCertificateRepo(),
    mockEmailService(opts.sendShouldFail),
  )

// ---------------------------------------------------------------------------
// Vault HTTP doubles
// ---------------------------------------------------------------------------

interface FakeVaultState {
  secret: { token: string; expires_at: number } | null
  loginCalls: number
  readCalls: number
  deleteCalls: number
}

function makeFakeVault(initial: FakeVaultState["secret"]): {
  state: FakeVaultState
  fetchImpl: typeof fetch
  readSaToken: () => Promise<string>
} {
  const state: FakeVaultState = { secret: initial, loginCalls: 0, readCalls: 0, deleteCalls: 0 }

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const method = (init?.method ?? "GET").toUpperCase()

    if (url.endsWith("/v1/auth/kubernetes/login")) {
      state.loginCalls++
      return new Response(JSON.stringify({ auth: { client_token: "fake-vault-token" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    if (url.endsWith("/v1/secret/data/duro/bootstrap-token") && method === "GET") {
      state.readCalls++
      if (!state.secret) {
        return new Response(JSON.stringify({ errors: ["not found"] }), { status: 404 })
      }
      return new Response(JSON.stringify({ data: { data: state.secret } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    if (url.endsWith("/v1/secret/metadata/duro/bootstrap-token") && method === "DELETE") {
      state.deleteCalls++
      state.secret = null
      return new Response(null, { status: 204 })
    }

    return new Response(JSON.stringify({ errors: ["unexpected url"] }), { status: 500 })
  }

  return { state, fetchImpl, readSaToken: async () => "fake-sa-token" }
}

const VAULT_ADDR = "http://vault.test"

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("submitBootstrapInviteAuto", () => {
  it.effect("happy path: creates invite, deletes Vault token", () => {
    __resetMutexForTests()
    const store = new Map<string, Invite>()
    const vault = makeFakeVault({ token: "vault-token", expires_at: Date.now() + 60_000 })

    return submitBootstrapInviteAuto(
      { email: "alice@example.com" },
      { vaultAddr: VAULT_ADDR, fetchImpl: vault.fetchImpl, readSaToken: vault.readSaToken },
    ).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.email).toBe("alice@example.com")
          expect(result.token).toMatch(/^tok-inv-/)
          expect(store.size).toBe(1)
          expect(vault.state.deleteCalls).toBe(1)
          expect(vault.state.secret).toBeNull()
        }),
      ),
      Effect.provide(allLayers(store)),
    )
  })

  it.effect("token expired: fails, Vault token NOT deleted", () => {
    __resetMutexForTests()
    const store = new Map<string, Invite>()
    const vault = makeFakeVault({ token: "vault-token", expires_at: Date.now() - 1000 })

    return submitBootstrapInviteAuto(
      { email: "alice@example.com" },
      { vaultAddr: VAULT_ADDR, fetchImpl: vault.fetchImpl, readSaToken: vault.readSaToken },
    ).pipe(
      Effect.flip,
      Effect.tap((err) =>
        Effect.sync(() => {
          expect(err.code).toBe("token_expired")
          expect(vault.state.deleteCalls).toBe(0)
          expect(vault.state.secret).not.toBeNull()
          expect(store.size).toBe(0)
        }),
      ),
      Effect.provide(allLayers(store)),
    )
  })

  it.effect("queueInvite failure (SMTP): fails, Vault token NOT deleted", () => {
    __resetMutexForTests()
    const store = new Map<string, Invite>()
    const vault = makeFakeVault({ token: "vault-token", expires_at: Date.now() + 60_000 })

    return submitBootstrapInviteAuto(
      { email: "alice@example.com" },
      { vaultAddr: VAULT_ADDR, fetchImpl: vault.fetchImpl, readSaToken: vault.readSaToken },
    ).pipe(
      Effect.flip,
      Effect.tap((err) =>
        Effect.sync(() => {
          expect(err.code).toBe("queue_failed")
          expect(vault.state.deleteCalls).toBe(0)
          expect(vault.state.secret).not.toBeNull()
        }),
      ),
      Effect.provide(allLayers(store, { sendShouldFail: true })),
    )
  })

  it.effect("email already in LLDAP: returns email_in_use, Vault token NOT deleted", () => {
    __resetMutexForTests()
    const store = new Map<string, Invite>()
    const vault = makeFakeVault({ token: "vault-token", expires_at: Date.now() + 60_000 })

    return submitBootstrapInviteAuto(
      { email: "alice@example.com" },
      { vaultAddr: VAULT_ADDR, fetchImpl: vault.fetchImpl, readSaToken: vault.readSaToken },
    ).pipe(
      Effect.flip,
      Effect.tap((err) =>
        Effect.sync(() => {
          expect(err.code).toBe("email_in_use")
          expect(vault.state.deleteCalls).toBe(0)
        }),
      ),
      Effect.provide(
        allLayers(store, {
          users: [{ id: "alice", email: "alice@example.com", displayName: "Alice", creationDate: "2025-01-01" }],
        }),
      ),
    )
  })

  it.effect("no token in Vault: returns no_token", () => {
    __resetMutexForTests()
    const store = new Map<string, Invite>()
    const vault = makeFakeVault(null)

    return submitBootstrapInviteAuto(
      { email: "alice@example.com" },
      { vaultAddr: VAULT_ADDR, fetchImpl: vault.fetchImpl, readSaToken: vault.readSaToken },
    ).pipe(
      Effect.flip,
      Effect.tap((err) =>
        Effect.sync(() => {
          expect(err.code).toBe("no_token")
        }),
      ),
      Effect.provide(allLayers(store)),
    )
  })
})

describe("submitBootstrapInviteWithCallerToken", () => {
  it.effect("token mismatch: fails, Vault token NOT deleted", () => {
    __resetMutexForTests()
    const store = new Map<string, Invite>()
    const vault = makeFakeVault({ token: "vault-token", expires_at: Date.now() + 60_000 })

    return submitBootstrapInviteWithCallerToken(
      { token: "WRONG", email: "alice@example.com" },
      { vaultAddr: VAULT_ADDR, fetchImpl: vault.fetchImpl, readSaToken: vault.readSaToken },
    ).pipe(
      Effect.flip,
      Effect.tap((err) =>
        Effect.sync(() => {
          expect(err.code).toBe("token_mismatch")
          expect(vault.state.deleteCalls).toBe(0)
          expect(vault.state.secret).not.toBeNull()
          expect(store.size).toBe(0)
        }),
      ),
      Effect.provide(allLayers(store)),
    )
  })

  it.effect("matching token: creates invite, deletes Vault token", () => {
    __resetMutexForTests()
    const store = new Map<string, Invite>()
    const vault = makeFakeVault({ token: "vault-token", expires_at: Date.now() + 60_000 })

    return submitBootstrapInviteWithCallerToken(
      { token: "vault-token", email: "alice@example.com" },
      { vaultAddr: VAULT_ADDR, fetchImpl: vault.fetchImpl, readSaToken: vault.readSaToken },
    ).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          expect(result.email).toBe("alice@example.com")
          expect(vault.state.deleteCalls).toBe(1)
          expect(vault.state.secret).toBeNull()
        }),
      ),
      Effect.provide(allLayers(store)),
    )
  })
})

describe("bootstrap mutex", () => {
  it.effect("rejects a concurrent submit with bootstrap_in_progress", () => {
    __resetMutexForTests()
    const store = new Map<string, Invite>()
    const vault = makeFakeVault({ token: "vault-token", expires_at: Date.now() + 60_000 })
    const deps = { vaultAddr: VAULT_ADDR, fetchImpl: vault.fetchImpl, readSaToken: vault.readSaToken }

    const first = submitBootstrapInviteAuto({ email: "alice@example.com" }, deps)
    const second = submitBootstrapInviteAuto({ email: "bob@example.com" }, deps)

    return Effect.all([first.pipe(Effect.either), second.pipe(Effect.either)], { concurrency: 2 }).pipe(
      Effect.tap((results) =>
        Effect.sync(() => {
          const errs = results.flatMap((r) => (r._tag === "Left" ? [r.left] : []))
          // Exactly one of the two must hit the in-progress branch; the other succeeds.
          expect(errs.length).toBe(1)
          expect(errs[0].code).toBe("bootstrap_in_progress")
        }),
      ),
      Effect.provide(allLayers(store)),
    )
  })
})
