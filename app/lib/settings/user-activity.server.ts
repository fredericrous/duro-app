import { Effect, Schema } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { enrichAuditEvents, loadAuditNameMaps } from "~/lib/governance/audit-naming"
import { AuditEventRow } from "~/lib/governance/types"

/**
 * Data behind the user-facing /settings/activity page ("was this you?" +
 * "what do I have access to, and why"). Plain Effect programs with direct
 * SQL so a real-PGlite test exercises them (AuditService.query can't express
 * the OR below, and AuditServiceDev returns [] anyway).
 */

export interface AccessRow {
  id: string
  /** Role or entitlement display name. */
  what: string | null
  app: string | null
  reason: string | null
  grantedAt: string
  expiresAt: string | null
}

/**
 * The user's recent security activity: their own actions, actions targeting
 * their principal, and grant/request events that carry their principal id in
 * metadata (how grant.created names its recipient).
 */
export const loadUserActivity = (principalId: string, limit = 20) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const raw = yield* sql`
      SELECT * FROM audit_events
      WHERE actor_id = ${principalId}
         OR (target_type = 'principal' AND target_id = ${principalId})
         OR metadata->>'principalId' = ${principalId}
      ORDER BY created_at DESC
      LIMIT ${limit}`
    const events = yield* Schema.decodeUnknown(Schema.Array(AuditEventRow))(raw)
    const maps = yield* loadAuditNameMaps
    return enrichAuditEvents(maps, events)
  })

/** The user's active grants with the "why": what, on which app, the recorded
 * reason, when it was granted and when it lapses. */
export const loadUserAccess = (principalId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql`
      SELECT g.id, g.reason, g.created_at, g.expires_at,
             COALESCE(r.display_name, e.display_name) AS what,
             a.display_name AS app
      FROM grants g
      LEFT JOIN roles r ON r.id = g.role_id
      LEFT JOIN entitlements e ON e.id = g.entitlement_id
      LEFT JOIN applications a ON a.id = COALESCE(r.application_id, e.application_id)
      WHERE g.principal_id = ${principalId}
        AND g.revoked_at IS NULL
        AND (g.expires_at IS NULL OR g.expires_at > now())
      ORDER BY app NULLS LAST, what`
    return rows.map((row) => {
      const r = row as {
        id: string
        reason: string | null
        createdAt: unknown
        expiresAt: unknown
        what: string | null
        app: string | null
      }
      return {
        id: r.id,
        what: r.what,
        app: r.app,
        reason: r.reason,
        grantedAt: new Date(r.createdAt as string | Date).toISOString(),
        expiresAt: r.expiresAt ? new Date(r.expiresAt as string | Date).toISOString() : null,
      } satisfies AccessRow
    })
  })
