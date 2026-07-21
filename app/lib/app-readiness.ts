export type ReadinessLevel = "draft" | "configured" | "grantable" | "provisioned"

export interface ReadinessSignals {
  /** An owner principal is assigned. */
  hasOwner: boolean
  /** A non-empty description is set. */
  hasDescription: boolean
  /** At least one role or entitlement exists — i.e. there's something to grant. */
  hasTarget: boolean
  /** At least one active (non-revoked, unexpired) grant exists. */
  hasGrant: boolean
}

/**
 * An application's maturity level, derived from the SAME signals as the per-app
 * setup checklist, expressed as a monotonic ladder:
 *
 *   draft       — metadata incomplete (no owner or no description)
 *   configured  — owner + description set, but nothing to grant yet (no roles/entitlements)
 *   grantable   — has a role/entitlement, so access can be granted — but nobody holds it yet
 *   provisioned — at least one person actually holds an active grant
 *
 * Turns the flat CRUD surface into clear, nameable progress. Pure so it can be
 * unit-tested and reused on both the app detail page and the applications list.
 */
export function applicationReadiness(s: ReadinessSignals): ReadinessLevel {
  if (!(s.hasOwner && s.hasDescription)) return "draft"
  if (!s.hasTarget) return "configured"
  if (!s.hasGrant) return "grantable"
  return "provisioned"
}

/** Badge tone per level — a subtle grey → blue → amber → green ramp. */
export const READINESS_TONE: Record<ReadinessLevel, "default" | "info" | "warning" | "success"> = {
  draft: "default",
  configured: "info",
  grantable: "warning",
  provisioned: "success",
}

/** Ascending maturity order, e.g. for sorting the applications list. */
export const READINESS_ORDER: Record<ReadinessLevel, number> = {
  draft: 0,
  configured: 1,
  grantable: 2,
  provisioned: 3,
}
