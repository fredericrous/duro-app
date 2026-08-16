// Runtime side of the settings → Git access mutation. Types, constants and
// the shared key validator live in `./settings-git-keys.ts` (client-safe).
//
// Unlike the api-keys sibling, every failure path returns a MACHINE CODE
// (`GitKeysErrorCode`), never prose — the component maps codes to i18n so the
// page is fully translatable (the sibling's raw-English strings are the
// anti-pattern this deliberately avoids).
//
// SECURITY INVARIANTS:
//  - a `private_key` rejection never echoes, logs, stores or audits the input;
//  - the delete path only ever passes a key id that was FIRST found in the
//    acting user's own key list (forged ids never reach the forge);
//  - audit metadata carries title/fingerprint/keyType — never the key body.
import { Effect } from "effect"
import { Buffer } from "node:buffer"
import { createHash } from "node:crypto"
import { ForgejoClient, ForgejoClientError } from "~/lib/services/ForgejoClient.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import { AuditService } from "~/lib/governance/AuditService.server"
import type { AuthInfo } from "~/lib/auth.server"
import {
  MAX_SSH_KEYS,
  validateKeyTitle,
  validateSshPublicKey,
  type SettingsGitKeysMutation,
  type SettingsGitKeysResult,
  type SshKeyValidation,
} from "./settings-git-keys"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Audit actor (best-effort: git keys must work even if governance sync lagged). */
function resolveActorId(auth: AuthInfo) {
  return Effect.gen(function* () {
    if (!auth.sub) return null
    const repo = yield* PrincipalRepo
    const principal = yield* repo.findByExternalId(auth.sub).pipe(Effect.catchAll(() => Effect.succeed(null)))
    return principal?.id ?? null
  })
}

/** The forge username IS the session username (= OIDC preferred_username —
 *  Forgejo's oauth2_client.USERNAME claim). NOT `externalId`, which holds the
 *  opaque OIDC `sub`. */
function resolveForgeUsername(auth: AuthInfo): string | null {
  const u = auth.user?.trim() ?? ""
  return u !== "" ? u : null
}

/** Server-authoritative structural check: the base64 blob must decode and its
 *  first length-prefixed field must equal the declared key type. */
function validateStrict(input: string): SshKeyValidation {
  const shape = validateSshPublicKey(input)
  if (!shape.ok) return shape
  let buf: Buffer
  try {
    buf = Buffer.from(shape.body, "base64")
  } catch {
    return { ok: false, reason: "bad_base64" }
  }
  if (buf.length < 8) return { ok: false, reason: "bad_base64" }
  const n = buf.readUInt32BE(0)
  if (n > 64 || buf.length < 4 + n) return { ok: false, reason: "bad_base64" }
  if (buf.subarray(4, 4 + n).toString("ascii") !== shape.keyType) return { ok: false, reason: "type_mismatch" }
  return shape
}

interface AuditEventInput {
  eventType: string
  actorId?: string
  targetType?: string
  targetId?: string
  metadata?: Record<string, unknown>
}

const emitAudit = (event: AuditEventInput): Effect.Effect<void, never, AuditService> =>
  Effect.gen(function* () {
    const audit = yield* AuditService
    yield* audit
      .emit(event)
      .pipe(Effect.catchAll((e) => Effect.logWarning(`${event.eventType} audit emit failed`, { error: String(e) })))
  })

/** OpenSSH-style fingerprint of a validated key body: SHA256:<base64, no pad>. */
const fingerprintOf = (base64Body: string): string =>
  `SHA256:${createHash("sha256").update(Buffer.from(base64Body, "base64")).digest("base64").replace(/=+$/, "")}`

const errorCode = (e: unknown): SettingsGitKeysResult =>
  e instanceof ForgejoClientError ? { gitKeyError: e.kind } : { gitKeyError: "unknown" }

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function handleAdd(mutation: Extract<SettingsGitKeysMutation, { intent: "addGitKey" }>) {
  return Effect.gen(function* () {
    const username = resolveForgeUsername(mutation.auth)
    if (!username) return { gitKeyError: "account_missing" as const } satisfies SettingsGitKeysResult
    const actorId = yield* resolveActorId(mutation.auth)

    // server-authoritative validation (defense in depth over the client's)
    const titleCheck = validateKeyTitle(mutation.title)
    if (!titleCheck.ok) return { gitKeyError: titleCheck.reason } satisfies SettingsGitKeysResult
    const keyCheck = validateStrict(mutation.publicKey)
    if (!keyCheck.ok) {
      if (keyCheck.reason === "private_key") {
        // security signal — NEVER any content, length, or prefix
        yield* emitAudit({
          eventType: "git_ssh_key.rejected",
          ...(actorId ? { actorId } : {}),
          targetType: "git_ssh_key",
          metadata: { forge: "forgejo", reason: "private_key_pasted" },
        })
      }
      return { gitKeyError: keyCheck.reason } satisfies SettingsGitKeysResult
    }

    const forgejo = yield* ForgejoClient
    const exists = yield* forgejo.userExists(username)
    if (!exists) return { gitKeyError: "account_missing" as const } satisfies SettingsGitKeysResult

    const existing = yield* forgejo.listKeys(username)

    // own-account duplicate → idempotent success: no POST, no `added` audit,
    // the UI highlights the existing row instead.
    const fingerprint = fingerprintOf(keyCheck.body)
    const already = existing.find((k) => k.fingerprint === fingerprint)
    if (already) {
      return {
        gitKeyAdded: true as const,
        id: already.id,
        title: already.title,
        fingerprint: already.fingerprint,
        alreadyPresent: true,
      } satisfies SettingsGitKeysResult
    }

    // cap (server-enforced independently of the UI)
    if (existing.length >= MAX_SSH_KEYS)
      return { gitKeyError: "too_many_keys" as const } satisfies SettingsGitKeysResult

    // title uniqueness within the user's own list (case-insensitive)
    if (existing.some((k) => k.title.toLowerCase() === titleCheck.title.toLowerCase()))
      return { gitKeyError: "title_taken" as const } satisfies SettingsGitKeysResult

    const created = yield* forgejo.addKey(username, { title: titleCheck.title, key: keyCheck.normalized }).pipe(
      Effect.catchAll((e) =>
        Effect.gen(function* () {
          if (e.kind === "key_in_use") {
            // Own-account duplicates were already handled by the fingerprint
            // pre-check above, so a 422 here means the key belongs to
            // ANOTHER account. Never name that account.
            yield* emitAudit({
              eventType: "git_ssh_key.rejected",
              ...(actorId ? { actorId } : {}),
              targetType: "git_ssh_key",
              metadata: { forge: "forgejo", reason: "key_in_use", fingerprint },
            })
          }
          if (e.kind === "unauthorized") {
            yield* emitAudit({
              eventType: "git.forge.misconfigured",
              ...(actorId ? { actorId } : {}),
              targetType: "git_forge",
              targetId: "forgejo",
              metadata: { forge: "forgejo", endpoint: "addKey", reason: "unauthorized" },
            })
            // the user can't act on "unauthorized" — surface as unavailable
            return yield* Effect.fail(new ForgejoClientError({ kind: "unavailable", message: e.message }))
          }
          return yield* Effect.fail(e)
        }),
      ),
    )

    yield* emitAudit({
      eventType: "git_ssh_key.added",
      ...(actorId ? { actorId } : {}),
      targetType: "git_ssh_key",
      targetId: String(created.id),
      metadata: {
        forge: "forgejo",
        forgeUser: username,
        title: created.title,
        keyType: created.keyType,
        fingerprint: created.fingerprint,
      },
    })

    return {
      gitKeyAdded: true as const,
      id: created.id,
      title: created.title,
      fingerprint: created.fingerprint,
      alreadyPresent: false,
    } satisfies SettingsGitKeysResult
  })
}

function handleDelete(mutation: Extract<SettingsGitKeysMutation, { intent: "deleteGitKey" }>) {
  return Effect.gen(function* () {
    const username = resolveForgeUsername(mutation.auth)
    if (!username) return { gitKeyError: "account_missing" as const } satisfies SettingsGitKeysResult
    const actorId = yield* resolveActorId(mutation.auth)

    const forgejo = yield* ForgejoClient
    // Anti-forgery: the id must be in the ACTING USER's own list before the
    // forge is ever asked to delete anything (sudo scopes it too — belt and
    // braces, and this also captures title/fingerprint for the audit row).
    const owned = yield* forgejo.listKeys(username)
    const target = owned.find((k) => k.id === mutation.keyId)
    if (!target) return { gitKeyError: "key_not_found" as const } satisfies SettingsGitKeysResult

    const alreadyAbsent = yield* forgejo.deleteKey(username, target.id).pipe(
      Effect.as(false),
      Effect.catchAll((e) =>
        e.kind === "key_not_found"
          ? Effect.succeed(true) // deleted elsewhere between list and delete — idempotent
          : Effect.fail(e),
      ),
    )

    yield* emitAudit({
      eventType: "git_ssh_key.removed",
      ...(actorId ? { actorId } : {}),
      targetType: "git_ssh_key",
      targetId: String(target.id),
      metadata: {
        forge: "forgejo",
        forgeUser: username,
        title: target.title,
        fingerprint: target.fingerprint,
        ...(alreadyAbsent ? { alreadyAbsent: true } : {}),
      },
    })

    return { gitKeyDeleted: true as const, keyId: target.id } satisfies SettingsGitKeysResult
  })
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function handleSettingsGitKeysMutation(mutation: SettingsGitKeysMutation) {
  const effect: Effect.Effect<
    SettingsGitKeysResult,
    ForgejoClientError | Error,
    ForgejoClient | PrincipalRepo | AuditService
  > = mutation.intent === "addGitKey" ? handleAdd(mutation) : handleDelete(mutation)
  return effect.pipe(Effect.catchAll((e) => Effect.succeed(errorCode(e))))
}

// ---------------------------------------------------------------------------
// FormData parser
// ---------------------------------------------------------------------------

export function parseSettingsGitKeysMutation(
  formData: FormData,
  auth: AuthInfo,
): SettingsGitKeysMutation | { error: string } {
  const intent = formData.get("intent") as string | null

  if (intent === "deleteGitKey") {
    const keyId = Number(formData.get("keyId"))
    if (!Number.isInteger(keyId) || keyId <= 0) return { error: "Missing keyId" }
    return { intent, auth, keyId }
  }

  if (intent !== "addGitKey") return { error: "Unknown intent" }

  const title = ((formData.get("title") as string) ?? "").trim()
  const publicKey = ((formData.get("publicKey") as string) ?? "").trim()
  if (!publicKey) return { error: "Missing key" }
  return { intent: "addGitKey", auth, title, publicKey }
}
