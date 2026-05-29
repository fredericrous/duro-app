// Client-safe surface for the settings → API keys mutation. The runtime
// handlers + form parser live in `./settings-api-keys.server.ts` because they
// need governance repos (Postgres). React Router 7 / Vite enforces a strict
// server/client split — any module containing a `.server.` import is treated
// as server-only and the client bundle refuses to traverse it. ApiKeysSection
// only needs the result type for state shaping, so it pulls from this file.
//
// Keep this file free of `.server` imports (type-only imports are fine —
// they're erased before the resolver runs).
import type { AuthInfo } from "~/lib/auth.server"
import { KNOWN_SCOPES, WILDCARD_SCOPE } from "~/lib/governance/scopes"

export const ALLOWED_EXPIRY_DAYS = [30, 90, 365] as const
export type AllowedExpiry = (typeof ALLOWED_EXPIRY_DAYS)[number]

export type SettingsApiKeysMutation =
  | {
      intent: "createApiKey"
      auth: AuthInfo
      name: string
      scopes: string[]
      expiresInDays: AllowedExpiry
      allowWildcard: boolean
    }
  | { intent: "revokeApiKey"; auth: AuthInfo; keyId: string }

export type SettingsApiKeysResult =
  | {
      apiKeyCreated: true
      id: string
      rawKey: string
      keyPreview: string
      name: string
      scopes: string[]
      expiresInDays: number
    }
  | { apiKeyRevoked: true; keyId: string }
  | { apiKeyError: string }

export { KNOWN_SCOPES, WILDCARD_SCOPE }
