// Runtime side of the settings → API keys mutation. Types and constants live
// in `./settings-api-keys.ts` (client-safe) so ApiKeysSection can read them
// without dragging governance repos into the client bundle. See that file's
// header for the why.
import { Effect } from "effect"
import { ApiKeyRepo } from "~/lib/governance/ApiKeyRepo.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import { AuditService } from "~/lib/governance/AuditService.server"
import { findUnknownScopes } from "~/lib/governance/scopes"
import type { AuthInfo } from "~/lib/auth.server"
import {
  ALLOWED_EXPIRY_DAYS,
  WILDCARD_SCOPE,
  type AllowedExpiry,
  type SettingsApiKeysMutation,
  type SettingsApiKeysResult,
} from "./settings-api-keys"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolvePrincipalId(auth: AuthInfo) {
  return Effect.gen(function* () {
    if (!auth.sub) {
      return yield* Effect.fail(new Error("No authenticated subject"))
    }
    const repo = yield* PrincipalRepo
    const principal = yield* repo.findByExternalId(auth.sub)
    if (!principal) {
      return yield* Effect.fail(new Error("Your account has no governance principal yet"))
    }
    return principal.id
  })
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function handleCreate(mutation: Extract<SettingsApiKeysMutation, { intent: "createApiKey" }>) {
  return Effect.gen(function* () {
    const principalId = yield* resolvePrincipalId(mutation.auth)

    const repo = yield* ApiKeyRepo
    const created = yield* repo.create({
      principalId,
      name: mutation.name,
      scopes: mutation.scopes,
      expiresInDays: mutation.expiresInDays,
    })

    const audit = yield* AuditService
    yield* audit
      .emit({
        eventType: "api_key.created",
        actorId: principalId,
        targetType: "api_key",
        targetId: created.id,
        metadata: {
          name: mutation.name,
          scopes: mutation.scopes,
          expiresInDays: mutation.expiresInDays,
          keyPreview: created.keyPreview,
          wildcard: mutation.scopes.includes(WILDCARD_SCOPE),
        },
      })
      .pipe(Effect.catchAll((e) => Effect.logWarning("api_key.created audit emit failed", { error: String(e) })))

    return {
      apiKeyCreated: true as const,
      id: created.id,
      rawKey: created.rawKey,
      keyPreview: created.keyPreview,
      name: mutation.name,
      scopes: mutation.scopes,
      expiresInDays: mutation.expiresInDays,
    } satisfies SettingsApiKeysResult
  })
}

function handleRevoke(mutation: Extract<SettingsApiKeysMutation, { intent: "revokeApiKey" }>) {
  return Effect.gen(function* () {
    const principalId = yield* resolvePrincipalId(mutation.auth)

    const repo = yield* ApiKeyRepo
    // Defense against forged form submits: a user may only revoke their own
    // keys via this surface. Admin-revokes-anyone is a separate flow.
    const owned = yield* repo.listForPrincipal(principalId)
    const target = owned.find((k) => k.id === mutation.keyId)
    if (!target) {
      return { apiKeyError: "Key not found" } satisfies SettingsApiKeysResult
    }
    if (target.revokedAt) {
      // Idempotent: already revoked, surface that as success so the UI
      // can collapse the row without a confusing error.
      return { apiKeyRevoked: true as const, keyId: target.id } satisfies SettingsApiKeysResult
    }

    yield* repo.revoke(target.id)

    const audit = yield* AuditService
    yield* audit
      .emit({
        eventType: "api_key.revoked",
        actorId: principalId,
        targetType: "api_key",
        targetId: target.id,
        metadata: { name: target.name, keyPreview: target.keyPreview },
      })
      .pipe(Effect.catchAll((e) => Effect.logWarning("api_key.revoked audit emit failed", { error: String(e) })))

    return { apiKeyRevoked: true as const, keyId: target.id } satisfies SettingsApiKeysResult
  })
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function handleSettingsApiKeysMutation(mutation: SettingsApiKeysMutation) {
  const effect: Effect.Effect<SettingsApiKeysResult, Error, ApiKeyRepo | PrincipalRepo | AuditService> =
    mutation.intent === "createApiKey" ? handleCreate(mutation) : handleRevoke(mutation)
  return effect.pipe(
    Effect.catchAll((e) => {
      const message =
        e instanceof Error
          ? e.message
          : typeof e === "object" && e !== null && "message" in e
            ? String((e as { message: unknown }).message)
            : "Operation failed"
      return Effect.succeed({ apiKeyError: message } satisfies SettingsApiKeysResult)
    }),
  )
}

// ---------------------------------------------------------------------------
// FormData parser
// ---------------------------------------------------------------------------

const MAX_NAME = 100

export function parseSettingsApiKeysMutation(
  formData: FormData,
  auth: AuthInfo,
): SettingsApiKeysMutation | { error: string } {
  const intent = formData.get("intent") as string | null

  if (intent === "revokeApiKey") {
    const keyId = (formData.get("keyId") as string) ?? ""
    if (!keyId) return { error: "Missing keyId" }
    return { intent, auth, keyId }
  }

  if (intent !== "createApiKey") return { error: "Unknown intent" }

  const name = ((formData.get("name") as string) ?? "").trim()
  if (!name) return { error: "Name is required" }
  if (name.length > MAX_NAME) return { error: `Name must be ${MAX_NAME} characters or fewer` }

  const expiryRaw = formData.get("expiresInDays")
  const expiresInDays = Number(expiryRaw)
  if (!ALLOWED_EXPIRY_DAYS.includes(expiresInDays as AllowedExpiry)) {
    return { error: "Pick a valid expiry (30, 90, or 365 days)" }
  }

  const allowWildcard = formData.get("allowWildcard") === "true"

  // If wildcard was explicitly opted into, ignore any concrete scopes —
  // `*` already covers them and mixing them is just confusing audit metadata.
  if (allowWildcard) {
    return {
      intent: "createApiKey",
      auth,
      name,
      scopes: [WILDCARD_SCOPE],
      expiresInDays: expiresInDays as AllowedExpiry,
      allowWildcard,
    }
  }

  const requestedScopes = formData.getAll("scopes").map(String).filter(Boolean)
  const concreteScopes = requestedScopes.filter((s) => s !== WILDCARD_SCOPE)
  if (concreteScopes.length === 0) {
    return { error: "Select at least one scope" }
  }
  const unknown = findUnknownScopes(concreteScopes)
  if (unknown.length > 0) {
    return { error: `Unknown scope(s): ${unknown.join(", ")}` }
  }

  return {
    intent: "createApiKey",
    auth,
    name,
    scopes: concreteScopes,
    expiresInDays: expiresInDays as AllowedExpiry,
    allowWildcard: false,
  }
}
