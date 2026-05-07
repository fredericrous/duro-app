import { Data, Effect } from "effect"
import * as fs from "node:fs/promises"
import { UserManager } from "~/lib/services/UserManager.server"
import { InviteRepo } from "~/lib/services/InviteRepo.server"
import { config } from "~/lib/config.server"
import { queueInvite, revokeInvite } from "~/lib/workflows/invite.server"

// ---------------------------------------------------------------------------
// Error type — string codes are the contract surfaced to the UI/i18n layer
// ---------------------------------------------------------------------------

export type BootstrapErrorCode =
  | "no_token"
  | "vault_unreachable"
  | "vault_invalid_response"
  | "token_mismatch"
  | "token_expired"
  | "email_invalid"
  | "email_in_use"
  | "admin_group_missing"
  | "bootstrap_in_progress"
  | "queue_failed"

export class BootstrapError extends Data.TaggedError("BootstrapError")<{
  readonly code: BootstrapErrorCode
  readonly message?: string
  readonly cause?: unknown
}> {}

// ---------------------------------------------------------------------------
// Vault HTTP helpers — kept here (not in a service) because Vault is only
// touched during bootstrap. If that grows, extract a VaultClient service.
// ---------------------------------------------------------------------------

const SA_TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token"
const SECRET_PATH = "/v1/secret/data/duro/bootstrap-token"
const SECRET_METADATA_PATH = "/v1/secret/metadata/duro/bootstrap-token"

interface VaultDeps {
  readonly vaultAddr: string
  readonly fetchImpl?: typeof fetch
  readonly readSaToken?: () => Promise<string>
}

const vaultLogin = (deps: VaultDeps) =>
  Effect.tryPromise({
    try: async () => {
      const fetchFn = deps.fetchImpl ?? fetch
      const readSa = deps.readSaToken ?? (() => fs.readFile(SA_TOKEN_PATH, "utf8"))
      const saToken = (await readSa()).trim()
      const resp = await fetchFn(`${deps.vaultAddr}/v1/auth/kubernetes/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jwt: saToken, role: "duro" }),
      })
      if (!resp.ok) {
        const body = await resp.text()
        throw new BootstrapError({ code: "vault_unreachable", message: `Vault login failed: ${body}` })
      }
      const data = (await resp.json()) as { auth?: { client_token?: string } }
      const token = data.auth?.client_token
      if (!token) {
        throw new BootstrapError({ code: "vault_invalid_response", message: "Vault login returned no client token" })
      }
      return token
    },
    catch: (e) => (e instanceof BootstrapError ? e : new BootstrapError({ code: "vault_unreachable", cause: e })),
  })

const readBootstrapSecret = (deps: VaultDeps, vaultToken: string) =>
  Effect.tryPromise({
    try: async () => {
      const fetchFn = deps.fetchImpl ?? fetch
      const resp = await fetchFn(`${deps.vaultAddr}${SECRET_PATH}`, {
        headers: { "X-Vault-Token": vaultToken },
      })
      if (resp.status === 404) {
        throw new BootstrapError({ code: "no_token", message: "No bootstrap token found in Vault" })
      }
      if (!resp.ok) {
        throw new BootstrapError({ code: "vault_unreachable", message: `Vault read failed: ${resp.status}` })
      }
      const body = (await resp.json()) as { data?: { data?: { token?: string; expires_at?: number | string } } }
      const tokenData = body.data?.data
      if (!tokenData || typeof tokenData.token !== "string" || tokenData.expires_at == null) {
        throw new BootstrapError({ code: "vault_invalid_response", message: "Bootstrap secret has invalid structure" })
      }
      return { token: tokenData.token, expiresAt: Number(tokenData.expires_at) }
    },
    catch: (e) => (e instanceof BootstrapError ? e : new BootstrapError({ code: "vault_unreachable", cause: e })),
  })

/**
 * Best-effort delete of the Vault secret. Failures are swallowed so they do
 * not mask a successful invite creation — the operator can clean up Vault
 * manually if needed. We log instead.
 */
const deleteBootstrapSecret = (deps: VaultDeps, vaultToken: string) =>
  Effect.tryPromise({
    try: async () => {
      const fetchFn = deps.fetchImpl ?? fetch
      await fetchFn(`${deps.vaultAddr}${SECRET_METADATA_PATH}`, {
        method: "DELETE",
        headers: { "X-Vault-Token": vaultToken },
      })
    },
    catch: () => undefined,
  }).pipe(Effect.catchAll(() => Effect.logWarning("bootstrap: failed to delete Vault token (best-effort)")))

// ---------------------------------------------------------------------------
// Invite creation — shared between the caller-token API endpoint and the
// auto-read wizard. Does NOT touch Vault. The Vault token consume is done
// by the outer submit functions only after this succeeds.
// ---------------------------------------------------------------------------

const validateEmail = (email: string) =>
  Effect.gen(function* () {
    const trimmed = email.trim()
    if (!trimmed) return yield* new BootstrapError({ code: "email_invalid", message: "email is required" })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return yield* new BootstrapError({ code: "email_invalid", message: `invalid email '${email}'` })
    }
    return trimmed
  })

export const createAdminInvite = (email: string) =>
  Effect.gen(function* () {
    const cleanEmail = yield* validateEmail(email)
    const userMgr = yield* UserManager
    const inviteRepo = yield* InviteRepo

    const groups = yield* userMgr.getGroups.pipe(
      Effect.mapError((e) => new BootstrapError({ code: "vault_unreachable", message: "LLDAP unreachable", cause: e })),
    )
    const adminGroup = groups.find((g) => g.displayName === config.adminGroupName)
    if (!adminGroup) {
      return yield* new BootstrapError({
        code: "admin_group_missing",
        message: `Admin group '${config.adminGroupName}' not found in LLDAP`,
      })
    }

    const existingUsers = yield* userMgr.getUsers.pipe(
      Effect.mapError((e) => new BootstrapError({ code: "vault_unreachable", message: "LLDAP unreachable", cause: e })),
    )
    const taken = existingUsers.find((u) => u.email.toLowerCase() === cleanEmail.toLowerCase())
    if (taken) {
      return yield* new BootstrapError({
        code: "email_in_use",
        message: `email '${cleanEmail}' already exists in LLDAP (user: ${taken.id})`,
      })
    }

    const pending = yield* inviteRepo
      .findPending()
      .pipe(Effect.mapError((e) => new BootstrapError({ code: "queue_failed", cause: e })))
    const stale = pending.find((i) => i.email === cleanEmail)
    if (stale) {
      yield* Effect.logWarning(`bootstrap: revoking existing pending invite for ${cleanEmail}`)
      yield* revokeInvite(stale.id).pipe(Effect.catchAll(() => Effect.void))
    }

    const result = yield* queueInvite({
      email: cleanEmail,
      groups: [adminGroup.id],
      groupNames: [config.adminGroupName],
      invitedBy: "bootstrap",
    }).pipe(
      Effect.mapError(
        (e) =>
          new BootstrapError({
            code: "queue_failed",
            message: e instanceof Error ? e.message : "queueInvite failed",
            cause: e,
          }),
      ),
    )

    return { token: result.token, email: cleanEmail }
  })

// ---------------------------------------------------------------------------
// Process-local mutex — protects against concurrent bootstrap submits within
// a single replica. Multi-replica deployments during first-run remain a
// documented caveat (Vault read-then-delete is not atomic across processes).
// ---------------------------------------------------------------------------

let inFlight = false

const withMutex = <R, E, A>(eff: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    if (inFlight) {
      return yield* new BootstrapError({ code: "bootstrap_in_progress" })
    }
    inFlight = true
    return yield* eff.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          inFlight = false
        }),
      ),
    )
  })

// ---------------------------------------------------------------------------
// Public submit helpers
// ---------------------------------------------------------------------------

const vaultDepsFromEnv = (): VaultDeps => ({
  vaultAddr: process.env.VAULT_ADDR ?? "",
})

/**
 * Used by the existing /api/bootstrap-invite endpoint — caller supplies
 * the bootstrap token in the request body. We validate it against Vault.
 */
export const submitBootstrapInviteWithCallerToken = (
  input: { token: string; email: string },
  depsOverride?: VaultDeps,
) =>
  withMutex(
    Effect.gen(function* () {
      const deps = depsOverride ?? vaultDepsFromEnv()
      if (!deps.vaultAddr) {
        return yield* new BootstrapError({ code: "vault_unreachable", message: "VAULT_ADDR not configured" })
      }

      const vaultToken = yield* vaultLogin(deps)
      const stored = yield* readBootstrapSecret(deps, vaultToken)

      if (stored.token !== input.token) {
        return yield* new BootstrapError({ code: "token_mismatch" })
      }
      if (Date.now() > stored.expiresAt) {
        return yield* new BootstrapError({ code: "token_expired" })
      }

      const result = yield* createAdminInvite(input.email)

      // Only consume the Vault token after the invite is fully created.
      yield* deleteBootstrapSecret(deps, vaultToken)

      return result
    }),
  )

/**
 * Used by the wizard at /admin/setup — token is read from Vault
 * server-side. The operator only enters their email.
 */
export const submitBootstrapInviteAuto = (input: { email: string }, depsOverride?: VaultDeps) =>
  withMutex(
    Effect.gen(function* () {
      const deps = depsOverride ?? vaultDepsFromEnv()
      if (!deps.vaultAddr) {
        return yield* new BootstrapError({ code: "vault_unreachable", message: "VAULT_ADDR not configured" })
      }

      const vaultToken = yield* vaultLogin(deps)
      const stored = yield* readBootstrapSecret(deps, vaultToken)

      if (Date.now() > stored.expiresAt) {
        return yield* new BootstrapError({ code: "token_expired" })
      }

      const result = yield* createAdminInvite(input.email)

      // Only consume the Vault token after the invite is fully created.
      yield* deleteBootstrapSecret(deps, vaultToken)

      return result
    }),
  )

// ---------------------------------------------------------------------------
// Test helpers — exported so tests can reset module state between cases.
// ---------------------------------------------------------------------------

/** @internal */
export const __resetMutexForTests = () => {
  inFlight = false
}
