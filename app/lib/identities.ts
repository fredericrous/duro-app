import type { UserCertificate } from "~/lib/services/CertificateRepo.server"
import type { Principal } from "~/lib/governance/types"
import { certStatus } from "~/lib/cert-status"

// The unified "Identities" screen merges two sources that model the same people
// from different angles:
//   - IdP/LLDAP users (human accounts + mTLS certs), keyed by uid.
//   - governance principals (grants/entitlements), keyed by a uuid, where a
//     `user`-type principal carries the uid in `externalId`.
// A principal is created lazily on first login (auth.callback), so an IdP user
// who has never logged in has no principal yet — we surface that as an
// un-provisioned "user" identity rather than hiding it. Non-user principals
// (group / service_account / device) have no IdP counterpart and stand alone.

export type IdentityType = "user" | "group" | "service_account" | "device"

const IDENTITY_TYPES: readonly IdentityType[] = ["user", "group", "service_account", "device"]
const TYPE_ORDER: Record<IdentityType, number> = { user: 0, group: 1, service_account: 2, device: 3 }

/** Minimal IdP user shape (from UserManager.getUsers). */
export interface IdpUser {
  id: string
  displayName: string
  email: string
  creationDate: string
}

export interface Identity {
  /** Stable row key: the principal id when one exists, else `user:<uid>`. */
  key: string
  type: IdentityType
  displayName: string
  email: string | null
  /** Governance enabled flag; `true` for IdP users with no principal yet. */
  enabled: boolean
  /** LLDAP uid — set for human `user` rows (provisioned or not). */
  uid: string | null
  /** Governance principal id — null for IdP users who've never logged in. */
  principalId: string | null
  /** mTLS certs (users only; always [] for groups/service accounts/devices). */
  certs: UserCertificate[]
  activeCertCount: number
  hasActiveCerts: boolean
  isSystem: boolean
  /** false when an IdP user has no governance principal yet (lazy creation). */
  provisioned: boolean
  creationDate: string | null
}

function coerceType(principalType: string): IdentityType {
  return (IDENTITY_TYPES as readonly string[]).includes(principalType) ? (principalType as IdentityType) : "user"
}

/**
 * Map a batch cert-revoke action result to a toast payload (or null when there's
 * nothing to announce). Pure so it's unit-testable without a fetcher round-trip.
 */
export function certBatchRevokeToast(
  data: unknown,
  t: (key: string, opts?: Record<string, unknown>) => string,
): { variant: "success" | "error"; message: string } | null {
  const d = data as { certsRevoked?: true; count?: number; error?: string }
  if (d.error) return { variant: "error", message: d.error }
  if (d.certsRevoked)
    return { variant: "success", message: t("admin.users.certs.certsRevoked", { count: d.count ?? 0 }) }
  return null
}

/** Build a POST FormData with one intent + a repeated field (batch mutations). */
export function buildBatchForm(intent: string, field: string, values: Iterable<string>): FormData {
  const fd = new FormData()
  fd.set("intent", intent)
  for (const v of values) fd.append(field, v)
  return fd
}

/**
 * Merge IdP users and governance principals into one faceted identity list.
 * Pure (no I/O) so the join — the risky part of the Users+Principals merge —
 * is unit-testable in isolation.
 */
export function buildIdentities(
  users: IdpUser[],
  principals: Principal[],
  certsByUser: Record<string, UserCertificate[]>,
  systemUserIds: string[],
): Identity[] {
  const systemSet = new Set(systemUserIds)

  // Index user-type principals by the uid they carry, so an IdP user can find
  // its governance principal. Partial-unique in the DB, so at most one each.
  const principalByUid = new Map<string, Principal>()
  for (const p of principals) {
    if (p.principalType === "user" && p.externalId) principalByUid.set(p.externalId, p)
  }

  const identities: Identity[] = []
  const claimedPrincipalIds = new Set<string>()

  // 1. IdP users → the "user" facet, LEFT JOINed onto their principal.
  for (const u of users) {
    const principal = principalByUid.get(u.id) ?? null
    if (principal) claimedPrincipalIds.add(principal.id)
    const certs = certsByUser[u.id] ?? []
    const activeCertCount = certs.filter((c) => certStatus(c) === "active").length
    identities.push({
      key: principal ? principal.id : `user:${u.id}`,
      type: "user",
      displayName: u.displayName || principal?.displayName || u.id,
      email: u.email || principal?.email || null,
      enabled: principal ? principal.enabled : true,
      uid: u.id,
      principalId: principal?.id ?? null,
      certs,
      activeCertCount,
      hasActiveCerts: activeCertCount > 0,
      isSystem: systemSet.has(u.id),
      provisioned: principal !== null,
      creationDate: u.creationDate ?? null,
    })
  }

  // 2. Principals with no live IdP user: non-user types always, plus any
  //    orphaned user-principal whose uid no longer resolves to an IdP account.
  for (const p of principals) {
    if (claimedPrincipalIds.has(p.id)) continue
    const type = coerceType(p.principalType)
    identities.push({
      key: p.id,
      type,
      displayName: p.displayName,
      email: p.email,
      enabled: p.enabled,
      uid: type === "user" ? p.externalId : null,
      principalId: p.id,
      certs: [],
      activeCertCount: 0,
      hasActiveCerts: false,
      isSystem: false,
      provisioned: true,
      creationDate: null,
    })
  }

  identities.sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.displayName.localeCompare(b.displayName))
  return identities
}
