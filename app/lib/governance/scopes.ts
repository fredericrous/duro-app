/**
 * Catalog of API-key scopes the settings UI exposes. The runtime check
 * (`requireScope` in api-auth.server.ts) is open-set — any string would
 * work — but the UI is closed-set on purpose so a typo can't silently
 * mint an unusable key.
 *
 * When you add a route that calls `requireScope("foo:bar")`, also add
 * it here so users can grant it from the UI.
 */
export const KNOWN_SCOPES = [
  {
    id: "invites:create",
    label: "Create user invites",
    description: "Issue a Vault PKI cert and email a P12 + invite link (POST /api/admin/invites).",
    recommended: true,
  },
  {
    id: "invitations:create",
    label: "Create access invitations",
    description: "Pre-grant a principal access to an app/role (POST /api/invitations).",
    recommended: false,
  },
  {
    id: "requests:create",
    label: "Submit access requests",
    description: "Open an access request as the key's principal (POST /api/access-requests).",
    recommended: false,
  },
  {
    id: "grants:read",
    label: "Read grants",
    description: "List active grants for a principal (GET /api/principals/:id/grants).",
    recommended: false,
  },
  {
    id: "authz:check",
    label: "Run authorization checks",
    description: "Evaluate policy allow/deny (POST /api/authz/check and check-bulk).",
    recommended: false,
  },
] as const

export type KnownScopeId = (typeof KNOWN_SCOPES)[number]["id"]

/** Sentinel for "give this key access to everything", behind a separate confirm. */
export const WILDCARD_SCOPE = "*" as const

/**
 * Validates that every scope is either a KNOWN_SCOPES id or the wildcard.
 * Returns the bad scope(s) for messaging; an empty array means valid.
 */
export function findUnknownScopes(scopes: readonly string[]): string[] {
  const valid = new Set<string>([...KNOWN_SCOPES.map((s) => s.id), WILDCARD_SCOPE])
  return scopes.filter((s) => !valid.has(s))
}
