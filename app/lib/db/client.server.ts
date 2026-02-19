import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import * as PgClient from "@effect/sql-pg/PgClient"
import * as SqlClient from "@effect/sql/SqlClient"
import * as Migrator from "@effect/sql/Migrator"
import { Context, Config, Effect, Layer } from "effect"

const snakeToCamel = (s: string) =>
  s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

// ---------------------------------------------------------------------------
// Dialect detection
// ---------------------------------------------------------------------------

export type Dialect = "sqlite" | "pg"
export const currentDialect: Dialect = process.env.DATABASE_URL ? "pg" : "sqlite"

// ---------------------------------------------------------------------------
// SqliteClient layer
// ---------------------------------------------------------------------------

export const SqliteClientLive = Layer.unwrapEffect(
  Config.string("DURO_DB_PATH").pipe(
    Config.withDefault("/db/duro.sqlite"),
    Effect.map((filename) =>
      SqliteClient.layer({
        filename,
        transformResultNames: snakeToCamel,
      }),
    ),
  ),
)

export const makeTestClientLayer = (filename: string) =>
  SqliteClient.layer({
    filename,
    transformResultNames: snakeToCamel,
  })

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

export class MigrationsRan extends Context.Tag("MigrationsRan")<
  MigrationsRan,
  true
>() {}

// ---------------------------------------------------------------------------
// Lightweight migration runner (no @effect/platform-node required)
// ---------------------------------------------------------------------------

const runMigrations = <R>(loader: Migrator.Loader<R>, dialect: Dialect) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    if (dialect === "sqlite") {
      yield* sql`PRAGMA busy_timeout = 5000`
    }

    if (dialect === "sqlite") {
      yield* sql`
        CREATE TABLE IF NOT EXISTS _migrations (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `
    } else {
      yield* sql`
        CREATE TABLE IF NOT EXISTS _migrations (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `
    }

    const applied = yield* sql`SELECT id FROM _migrations ORDER BY id`
    const appliedIds = new Set(applied.map((r: any) => r.id))

    const migrations = yield* loader
    const sorted = [...migrations].sort(([a], [b]) => a - b)

    for (const [id, name, load] of sorted) {
      if (appliedIds.has(id)) continue
      // load is Effect.promise(() => module); resolve and extract default export
      const mod = yield* load
      const migration = Effect.isEffect(mod)
        ? mod
        : (mod as any).default?.default ?? (mod as any).default
      yield* migration
      yield* sql`INSERT INTO _migrations (id, name) VALUES (${id}, ${name})`
      yield* Effect.log(`migration ${id}_${name} applied`)
    }
  })

// ---------------------------------------------------------------------------
// Migrator layer (glob-based, works with Vite and Vitest)
// ---------------------------------------------------------------------------

const sqliteMigrations = import.meta.glob("./migrations/sqlite/*.ts")
const pgMigrations = import.meta.glob("./migrations/pg/*.ts")

const ClientLive = currentDialect === "pg" ? PgClientLive : SqliteClientLive

export const MigratorLive = Layer.effect(
  MigrationsRan,
  runMigrations(
    Migrator.fromGlob(currentDialect === "pg" ? pgMigrations : sqliteMigrations),
    currentDialect,
  ).pipe(Effect.as(true as const)),
)

/**
 * Combined layer: Client + migrations.
 * Provides SqlClient.SqlClient and MigrationsRan.
 * Migrations run before any downstream layer is built.
 */
export const DbLive = MigratorLive.pipe(
  Layer.provideMerge(ClientLive),
)

// Tests always use SQLite
export const makeTestDbLayer = (filename: string) => {
  const testMigrations = import.meta.glob("./migrations/sqlite/*.ts")
  return Layer.effect(
    MigrationsRan,
    runMigrations(Migrator.fromGlob(testMigrations), "sqlite").pipe(
      Effect.as(true as const),
    ),
  ).pipe(Layer.provideMerge(makeTestClientLayer(filename)))
}
