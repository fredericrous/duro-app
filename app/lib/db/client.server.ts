import * as PgClient from "@effect/sql-pg/PgClient"
import * as SqlClient from "@effect/sql/SqlClient"
import * as SqlError from "@effect/sql/SqlError"
import { Context, Config, Duration, Effect, Layer } from "effect"
import { statSync } from "node:fs"

import { seedDevFixtures } from "./seed-dev.server"

import m0001 from "./migrations/pg/0001_create_schema"
import m0002 from "./migrations/pg/0002_create_user_revocations"
import m0003 from "./migrations/pg/0003_add_revert_pr_columns"
import m0004 from "./migrations/pg/0004_add_locale"
import m0005 from "./migrations/pg/0005_add_cert_renewal_tracking"
import m0006 from "./migrations/pg/0006_create_user_certificates"
import m0007 from "./migrations/pg/0007_create_governance_core"
import m0008 from "./migrations/pg/0008_create_rbac_model"
import m0009 from "./migrations/pg/0009_create_access_requests"
import m0010 from "./migrations/pg/0010_create_provisioning"
import m0011 from "./migrations/pg/0011_add_application_last_synced_at"
import m0012 from "./migrations/pg/0012_plugin_connected_systems"
import m0013 from "./migrations/pg/0013_access_request_dedup_index"
import m0014 from "./migrations/pg/0014_add_application_url"
import m0015 from "./migrations/pg/0015_reclassify_access_modes"
import m0016 from "./migrations/pg/0016_lock_garage_webui"
import m0017 from "./migrations/pg/0017_add_api_key_preview"
import m0018 from "./migrations/pg/0018_add_invite_open_tracking"
import m0019 from "./migrations/pg/0019_add_invite_click_tracking"
import m0020 from "./migrations/pg/0020_add_invite_delivery_tracking"
import m0021 from "./migrations/pg/0021_add_cert_reveal_tokens"
import m0022 from "./migrations/pg/0022_add_certificate_label"
import m0023 from "./migrations/pg/0023_create_recovery_requests"
import m0024 from "./migrations/pg/0024_grants_resource_restrict"
import m0025 from "./migrations/pg/0025_seed_duro_governance"
import m0026 from "./migrations/pg/0026_seed_app_access"
import m0027 from "./migrations/pg/0027_add_display_preferences"
import m0028 from "./migrations/pg/0028_seed_catalog_info"
import m0029 from "./migrations/pg/0029_add_theme_preference"
import m0030 from "./migrations/pg/0030_add_cert_renewal_lineage"

const snakeToCamel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

// ---------------------------------------------------------------------------
// PgClient layer (Config-driven — resolves DATABASE_URL at layer build time)
// ---------------------------------------------------------------------------

// connectionTTL bounds the lifetime of any pooled connection so a stuck
// connection (e.g. surviving a CNPG primary failover with stale TCP state)
// can't keep failing the pool indefinitely. Without this, pg.Pool reuses
// connections until they error — and a half-broken pool can keep
// surfacing ECONNREFUSED long after postgres is reachable again.
// idleTimeout: close idle connections quickly so we don't keep stale
// sockets around between bursts.
// applicationName: shows up in pg_stat_activity for triage.
const PgClientLive = Layer.unwrapEffect(
  Config.redacted("DATABASE_URL").pipe(
    Effect.map((url) =>
      PgClient.layer({
        url,
        transformResultNames: snakeToCamel,
        applicationName: "duro-app",
        connectionTTL: Duration.minutes(5),
        idleTimeout: Duration.seconds(30),
      }),
    ),
  ),
)

// ---------------------------------------------------------------------------
// Migration marker — InviteRepo depends on this to guarantee ordering
// ---------------------------------------------------------------------------

export class MigrationsRan extends Context.Tag("MigrationsRan")<MigrationsRan, true>() {}

// ---------------------------------------------------------------------------
// Lightweight migration runner
// ---------------------------------------------------------------------------

const migrations: Array<
  [id: number, name: string, effect: Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient>]
> = [
  [1, "create_schema", m0001],
  [2, "create_user_revocations", m0002],
  [3, "add_revert_pr_columns", m0003],
  [4, "add_locale", m0004],
  [5, "add_cert_renewal_tracking", m0005],
  [6, "create_user_certificates", m0006],
  [7, "create_governance_core", m0007],
  [8, "create_rbac_model", m0008],
  [9, "create_access_requests", m0009],
  [10, "create_provisioning", m0010],
  [11, "add_application_last_synced_at", m0011],
  [12, "plugin_connected_systems", m0012],
  [13, "access_request_dedup_index", m0013],
  [14, "add_application_url", m0014],
  [15, "reclassify_access_modes", m0015],
  [16, "lock_garage_webui", m0016],
  [17, "add_api_key_preview", m0017],
  [18, "add_invite_open_tracking", m0018],
  [19, "add_invite_click_tracking", m0019],
  [20, "add_invite_delivery_tracking", m0020],
  [21, "add_cert_reveal_tokens", m0021],
  [22, "add_certificate_label", m0022],
  [23, "create_recovery_requests", m0023],
  [24, "grants_resource_restrict", m0024],
  [25, "seed_duro_governance", m0025],
  [26, "seed_app_access", m0026],
  [27, "add_display_preferences", m0027],
  [28, "seed_catalog_info", m0028],
  [29, "add_theme_preference", m0029],
  [30, "add_cert_renewal_lineage", m0030],
]

const runMigrations = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `

  const applied = yield* sql`SELECT id FROM _migrations ORDER BY id`
  const appliedIds = new Set(applied.map((r: any) => r.id))

  yield* Effect.log(`migrations: discovered ${migrations.length}, already applied ${appliedIds.size}`)
  // Also emit to stdout directly: the app's Effect logger ships to OTLP, which
  // is not captured in some environments (e.g. the CI prod-clone check, whose
  // ephemeral runner never flushes the exporter). A raw console write is the
  // only channel guaranteed to reach stdout/stderr, so a migration that hangs
  // or fails is diagnosable from plain logs instead of silently wedging boot.
  console.log(`[migrations] discovered ${migrations.length}, already applied ${appliedIds.size}`)

  let newCount = 0
  for (const [id, name, migration] of migrations) {
    if (appliedIds.has(id)) continue
    console.log(`[migrations] applying ${id}_${name}...`)
    yield* migration.pipe(
      Effect.tapError((e) =>
        Effect.sync(() => console.error(`[migrations] ${id}_${name} FAILED:`, e instanceof Error ? e.stack : e)),
      ),
      Effect.tapError((e) => Effect.logError(`migration ${id}_${name} failed`, e)),
    )
    yield* sql`INSERT INTO _migrations (id, name) VALUES (${id}, ${name})`
    yield* Effect.log(`migration ${id}_${name} applied`)
    console.log(`[migrations] ${id}_${name} applied`)
    newCount++
  }

  if (newCount > 0) {
    yield* Effect.log(`migrations: ${newCount} new migration(s) applied`)
  } else {
    yield* Effect.log(`migrations: all ${migrations.length} already applied, nothing to do`)
  }
})

// ---------------------------------------------------------------------------
// Combined layer: Client + migrations
// ---------------------------------------------------------------------------

export const MigratorLive = Layer.effect(MigrationsRan, runMigrations.pipe(Effect.as(true as const)))

/**
 * Combined layer: Client + migrations.
 * Provides SqlClient.SqlClient and MigrationsRan.
 * Migrations run before any downstream layer is built.
 */
export const DbLive = MigratorLive.pipe(Layer.provideMerge(PgClientLive))

/**
 * Dev layer: uses an in-memory PGlite instance (no external Postgres needed).
 * Data persists for the lifetime of the dev server process.
 */
const PgLiteClientLayer = PgClient.layerFromPool({
  acquire: Effect.acquireRelease(
    Effect.promise(async () => {
      const { createPglitePool } = await import("./pglite-pool")
      return createPglitePool()
    }),
    (pool) => Effect.promise(() => pool.end()),
  ),
  transformResultNames: snakeToCamel,
})

const seedDevData = Effect.gen(function* () {
  yield* runMigrations
  const sql = yield* SqlClient.SqlClient
  yield* Effect.log("seeding dev data")
  yield* seedDevFixtures(sql)
}).pipe(Effect.as(true as const))

export const DbDevLive = Layer.effect(MigrationsRan, seedDevData).pipe(Layer.provideMerge(PgLiteClientLayer))

/**
 * Embedded production layer: a file-backed PGlite (postgres-in-process) that
 * persists to `dataDir`. Runs the real migrations — NO dev seed — so it's a
 * genuine single-pod, zero-external-dependency deployment option (the chart's
 * `database.mode: embedded`). Selected when DURO_DB_PATH is set.
 */
/**
 * DURO_DB_PATH names a PGlite *data directory*. Handed a regular file, PGlite
 * aborts inside WASM with a bare `Program terminated with exit(1)` that names
 * neither the path nor the reason. The variable used to point at a SQLite file
 * before the Postgres migration, so a leftover `duro-dev.sqlite` from that era
 * lands exactly here — say so instead.
 *
 * A missing path is fine: PGlite creates it.
 */
export function assertUsableDataDir(dataDir: string): void {
  let stats
  try {
    stats = statSync(dataDir)
  } catch {
    return
  }
  if (!stats.isDirectory()) {
    throw new Error(
      `DURO_DB_PATH must point at a directory for the PGlite data store, but "${dataDir}" is a file. ` +
        `If it is a leftover SQLite database from before the Postgres migration, move it aside and restart.`,
    )
  }
}

export const makeEmbeddedDbLayer = (dataDir: string) => {
  const EmbeddedClientLayer = PgClient.layerFromPool({
    acquire: Effect.acquireRelease(
      Effect.promise(async () => {
        assertUsableDataDir(dataDir)
        const { createPglitePool } = await import("./pglite-pool")
        return createPglitePool({ dataDir })
      }),
      (pool) => Effect.promise(() => pool.end()),
    ),
    transformResultNames: snakeToCamel,
  })
  return MigratorLive.pipe(Layer.provideMerge(EmbeddedClientLayer))
}

/**
 * Test layer: uses an in-memory PGlite instance (no external Postgres needed).
 * Runs migrations then truncates all data tables for a clean test state.
 */
export const makeTestDbLayer = () => {
  const migrateAndClean = Effect.gen(function* () {
    yield* runMigrations
    const sql = yield* SqlClient.SqlClient
    yield* sql`TRUNCATE
      provisioning_jobs, connector_mappings, connected_systems,
      api_keys, audit_events, access_invitations,
      request_approvals, access_requests, approval_policies,
      grants, role_entitlements, entitlements, roles, resources,
      group_mappings, applications, group_memberships, principals,
      invites, user_revocations, user_preferences, user_certificates,
      cert_reveal_tokens
      RESTART IDENTITY CASCADE`
  }).pipe(Effect.as(true as const))

  return Layer.effect(MigrationsRan, migrateAndClean).pipe(Layer.provideMerge(PgLiteClientLayer))
}
