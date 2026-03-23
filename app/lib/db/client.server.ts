import * as PgClient from "@effect/sql-pg/PgClient"
import * as SqlClient from "@effect/sql/SqlClient"
import * as SqlError from "@effect/sql/SqlError"
import { Context, Config, Effect, Layer } from "effect"
import * as crypto from "node:crypto"

import m0001 from "./migrations/pg/0001_create_schema"
import m0002 from "./migrations/pg/0002_create_user_revocations"
import m0003 from "./migrations/pg/0003_add_revert_pr_columns"
import m0004 from "./migrations/pg/0004_add_locale"
import m0005 from "./migrations/pg/0005_add_cert_renewal_tracking"
import m0006 from "./migrations/pg/0006_create_user_certificates"

const snakeToCamel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

// ---------------------------------------------------------------------------
// PgClient layer (Config-driven — resolves DATABASE_URL at layer build time)
// ---------------------------------------------------------------------------

const PgClientLive = Layer.unwrapEffect(
  Config.redacted("DATABASE_URL").pipe(
    Effect.map((url) =>
      PgClient.layer({
        url,
        transformResultNames: snakeToCamel,
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

  let newCount = 0
  for (const [id, name, migration] of migrations) {
    if (appliedIds.has(id)) continue
    yield* migration.pipe(Effect.tapError((e) => Effect.logError(`migration ${id}_${name} failed`, e)))
    yield* sql`INSERT INTO _migrations (id, name) VALUES (${id}, ${name})`
    yield* Effect.log(`migration ${id}_${name} applied`)
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

  // Only seed if empty
  const existing = yield* sql`SELECT COUNT(*) as count FROM user_certificates`
  if ((existing[0] as any).count > 0) return

  yield* Effect.log("seeding dev data")
  const now = new Date().toISOString()
  const expires = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()

  const users = [
    { id: "dev", email: "dev@localhost", serial: "aa:bb:cc:dd:00:00:00:01" },
    { id: "alice", email: "alice@example.com", serial: "aa:bb:cc:dd:00:00:00:02" },
    { id: "alice", email: "alice@example.com", serial: "aa:bb:cc:dd:00:00:00:04" },
    { id: "alice", email: "alice@example.com", serial: "aa:bb:cc:dd:00:00:00:05" },
    { id: "bob", email: "bob@example.com", serial: "aa:bb:cc:dd:00:00:00:03" },
  ]

  for (const u of users) {
    yield* sql`
      INSERT INTO user_certificates (id, invite_id, user_id, username, email, serial_number, issued_at, expires_at)
      VALUES (${crypto.randomUUID()}, ${crypto.randomUUID()}, ${u.id}, ${u.id}, ${u.email}, ${u.serial}, ${now}, ${expires})
    `
  }
  yield* Effect.log("dev seed complete: 3 users with certificates (alice has 3)")
}).pipe(Effect.as(true as const))

export const DbDevLive = Layer.effect(MigrationsRan, seedDevData).pipe(Layer.provideMerge(PgLiteClientLayer))

/**
 * Test layer: uses an in-memory PGlite instance (no external Postgres needed).
 * Runs migrations then truncates all data tables for a clean test state.
 */
export const makeTestDbLayer = () => {
  const migrateAndClean = Effect.gen(function* () {
    yield* runMigrations
    const sql = yield* SqlClient.SqlClient
    yield* sql`TRUNCATE invites, user_revocations, user_preferences, user_certificates RESTART IDENTITY CASCADE`
  }).pipe(Effect.as(true as const))

  return Layer.effect(MigrationsRan, migrateAndClean).pipe(Layer.provideMerge(PgLiteClientLayer))
}
