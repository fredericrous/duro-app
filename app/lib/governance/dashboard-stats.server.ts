import { Effect, Schema } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { enrichAuditEvents, loadAuditNameMaps } from "./audit-naming"
import { AuditEventRow } from "./types"

/**
 * Aggregates behind the admin Overview dashboard. Plain Effect programs so
 * the SQL is exercised by a real-PGlite test (route tests mock runEffect and
 * would never run inline SQL). Each consumer wraps with `.catch()` so a
 * failing aggregate degrades that panel, never the page.
 *
 * Audit reads go through direct SQL on purpose: AuditServiceDev (tests/dev)
 * returns [] from query() and has no aggregate API.
 */

export interface GlanceStats {
  people: number
  serviceAccounts: number
  applicationsEnabled: number
  applicationsTotal: number
  activeGrants: number
  activeApiKeys: number
}

export interface ExpiringItem {
  kind: "grant" | "certificate" | "apiKey" | "invitation"
  /** Who/what the expiry concerns, already display-named. */
  label: string
  expiresAt: string
}

export interface HygieneExtras {
  failedProvisioningJobs: number
  connectorsWithErrors: number
}

const count = (r: readonly unknown[]) => ((r[0] as { n?: number } | undefined)?.n ?? 0) as number

export const loadGlanceStats = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const [people, svc, appsEnabled, appsTotal, grants, keys] = yield* Effect.all(
    [
      sql`SELECT count(*)::int AS n FROM principals WHERE principal_type = 'user'`,
      sql`SELECT count(*)::int AS n FROM principals WHERE principal_type = 'service_account'`,
      sql`SELECT count(*)::int AS n FROM applications WHERE enabled = true`,
      sql`SELECT count(*)::int AS n FROM applications`,
      sql`SELECT count(*)::int AS n FROM grants
        WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
      sql`SELECT count(*)::int AS n FROM api_keys
        WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
    ],
    { concurrency: "unbounded" },
  )
  return {
    people: count(people),
    serviceAccounts: count(svc),
    applicationsEnabled: count(appsEnabled),
    applicationsTotal: count(appsTotal),
    activeGrants: count(grants),
    activeApiKeys: count(keys),
  } satisfies GlanceStats
})

/** Everything with a deadline in the next `days` (default 30), soonest first,
 * capped — grants, mTLS device certificates, API keys, pending invitations. */
export const loadExpiringSoon = (days = 30, cap = 8) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const horizon = `${days} days`
    const [grants, certs, keys, invites] = yield* Effect.all(
      [
        sql`SELECT g.expires_at, p.display_name AS who, COALESCE(r.display_name, e.display_name) AS what
          FROM grants g
          JOIN principals p ON p.id = g.principal_id
          LEFT JOIN roles r ON r.id = g.role_id
          LEFT JOIN entitlements e ON e.id = g.entitlement_id
          WHERE g.revoked_at IS NULL
            AND g.expires_at BETWEEN now() AND now() + ${horizon}::interval`,
        sql`SELECT username, expires_at FROM user_certificates
          WHERE revoked_at IS NULL
            AND expires_at BETWEEN now() AND now() + ${horizon}::interval`,
        sql`SELECT k.name, k.expires_at, p.display_name AS who
          FROM api_keys k
          JOIN principals p ON p.id = k.principal_id
          WHERE k.revoked_at IS NULL
            AND k.expires_at BETWEEN now() AND now() + ${horizon}::interval`,
        sql`SELECT i.expires_at, p.display_name AS who, a.display_name AS app
          FROM access_invitations i
          LEFT JOIN principals p ON p.id = i.invited_principal_id
          LEFT JOIN applications a ON a.id = i.application_id
          WHERE i.status = 'pending'
            AND i.expires_at BETWEEN now() AND now() + ${horizon}::interval`,
      ],
      { concurrency: "unbounded" },
    )

    const iso = (v: unknown) => new Date(v as string | Date).toISOString()
    const items: ExpiringItem[] = [
      ...grants.map((g) => {
        const row = g as { expiresAt: unknown; who: string | null; what: string | null }
        return {
          kind: "grant" as const,
          label: [row.what, row.who].filter(Boolean).join(" → "),
          expiresAt: iso(row.expiresAt),
        }
      }),
      ...certs.map((c) => {
        const row = c as { username: string; expiresAt: unknown }
        return { kind: "certificate" as const, label: row.username, expiresAt: iso(row.expiresAt) }
      }),
      ...keys.map((k) => {
        const row = k as { name: string; who: string | null; expiresAt: unknown }
        return {
          kind: "apiKey" as const,
          label: [row.name, row.who].filter(Boolean).join(" — "),
          expiresAt: iso(row.expiresAt),
        }
      }),
      ...invites.map((i) => {
        const row = i as { who: string | null; app: string | null; expiresAt: unknown }
        return {
          kind: "invitation" as const,
          label: [row.who, row.app].filter(Boolean).join(" → "),
          expiresAt: iso(row.expiresAt),
        }
      }),
    ]
    return items.sort((a, b) => a.expiresAt.localeCompare(b.expiresAt)).slice(0, cap)
  })

/** Last N audit events, name-enriched — the "what happened while I was away" feed. */
export const loadRecentActivity = (limit = 10) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const raw = yield* sql`SELECT * FROM audit_events ORDER BY created_at DESC LIMIT ${limit}`
    const events = yield* Schema.decodeUnknown(Schema.Array(AuditEventRow))(raw)
    const maps = yield* loadAuditNameMaps
    return enrichAuditEvents(maps, events)
  })

export const loadHygieneExtras = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const [jobs, connectors] = yield* Effect.all(
    [
      sql`SELECT count(*)::int AS n FROM provisioning_jobs WHERE status = 'failed'`,
      sql`SELECT count(*)::int AS n FROM connected_systems WHERE last_error IS NOT NULL OR status = 'error'`,
    ],
    { concurrency: "unbounded" },
  )
  return {
    failedProvisioningJobs: count(jobs),
    connectorsWithErrors: count(connectors),
  } satisfies HygieneExtras
})
