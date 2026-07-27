import { Effect } from "effect"
import { PrincipalRepo } from "./PrincipalRepo.server"
import { ApplicationRepo } from "./ApplicationRepo.server"
import { RbacRepo } from "./RbacRepo.server"
import type { AuditEvent } from "./types"

/**
 * Shared audit-event display helpers: metadata sanitizing, name maps and
 * polymorphic target resolution. Used by the admin audit table, the admin
 * dashboard "Recent activity" feed and the user settings activity page so
 * all three parse JSONB metadata and name targets identically.
 */

export type AuditEventWithNames = AuditEvent & {
  metadata: Record<string, unknown>
  actorName: string | null
  applicationName: string | null
  targetName: string | null
}

export interface AuditNameMaps {
  actorMap: Map<string, string>
  appNameById: Map<string, string>
  roleNameById: Map<string, string>
  entNameById: Map<string, string>
}

/** Ensure metadata is always a plain serializable object so react-router's
 * JSON serialization doesn't blow up on weird JSONB values (raw strings,
 * circular refs, cause objects, …). */
export function safeParseMetadata(metadata: unknown): Record<string, unknown> {
  if (metadata === null || metadata === undefined) return {}
  if (typeof metadata === "string") {
    try {
      return JSON.parse(metadata) as Record<string, unknown>
    } catch {
      return { _raw: metadata }
    }
  }
  if (typeof metadata === "object" && !Array.isArray(metadata)) {
    try {
      JSON.stringify(metadata)
      return metadata as Record<string, unknown>
    } catch {
      return { _error: "non-serializable metadata" }
    }
  }
  return {}
}

/** Load the id→displayName maps used to enrich audit rows. Fine at this
 * scale — full lists, no extra per-row queries. */
export const loadAuditNameMaps = Effect.gen(function* () {
  const principalRepo = yield* PrincipalRepo
  const appRepo = yield* ApplicationRepo
  const rbac = yield* RbacRepo
  const [principals, apps, roles, entitlements] = [
    yield* principalRepo.list(),
    yield* appRepo.list(),
    yield* rbac.listAllRoles(),
    yield* rbac.listAllEntitlements(),
  ]
  return {
    actorMap: new Map(principals.map((p) => [p.id, p.displayName])),
    appNameById: new Map(apps.map((a) => [a.id, a.displayName])),
    roleNameById: new Map(roles.map((r) => [r.id, r.displayName])),
    entNameById: new Map(entitlements.map((en) => [en.id, en.displayName])),
  } satisfies AuditNameMaps
})

/**
 * Resolve a polymorphic audit target (targetType + targetId) to a name.
 * Directly-nameable entities are looked up by id; grant/access_request rows
 * have a UUID target but carry the meaningful role/entitlement (and
 * recipient) in their metadata, so we describe them from that instead.
 * Everything reuses the already-loaded maps — no extra queries. Types we
 * can't name (user_certificate, api_key, recovery_request, …) keep their id.
 */
export function resolveTarget(
  maps: AuditNameMaps,
  type: string | null,
  id: string | null,
  meta: Record<string, unknown>,
): string | null {
  if (!id) return null
  switch (type) {
    case "principal":
      return maps.actorMap.get(id) ?? null
    case "application":
      return maps.appNameById.get(id) ?? null
    case "role":
      return maps.roleNameById.get(id) ?? null
    case "entitlement":
      return maps.entNameById.get(id) ?? null
    case "grant":
    case "access_request": {
      const roleId = typeof meta.roleId === "string" ? meta.roleId : null
      const entId = typeof meta.entitlementId === "string" ? meta.entitlementId : null
      const principalId = typeof meta.principalId === "string" ? meta.principalId : null
      const what = roleId ? maps.roleNameById.get(roleId) : entId ? maps.entNameById.get(entId) : null
      const who = principalId ? maps.actorMap.get(principalId) : null
      if (what && who) return `${what} → ${who}`
      return what ?? who ?? null
    }
    default:
      return null
  }
}

/** Sanitize metadata + attach actor/application/target display names. */
export function enrichAuditEvents(maps: AuditNameMaps, raw: readonly AuditEvent[]): AuditEventWithNames[] {
  return raw.map((e) => {
    const metadata = safeParseMetadata(e.metadata)
    return {
      ...e,
      metadata,
      actorName: e.actorId ? (maps.actorMap.get(e.actorId) ?? null) : null,
      applicationName: e.applicationId ? (maps.appNameById.get(e.applicationId) ?? null) : null,
      targetName: resolveTarget(maps, e.targetType, e.targetId, metadata),
    }
  })
}
