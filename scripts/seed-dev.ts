#!/usr/bin/env -S npx tsx
/**
 * Apply the development fixtures to the database the dev server uses.
 *
 *   npm run seed:dev
 *
 * The in-memory dev layer seeds itself on boot, but a file-backed dev database
 * (`DURO_DB_PATH`) does not — that layer runs the real migrations and nothing
 * else, by design, because it is also the chart's `mode: embedded` production
 * path. This script is how that database gets a catalog to look at.
 *
 * Safe to re-run: every insert is ON CONFLICT DO NOTHING, so it tops up a
 * database seeded before newer fixtures existed.
 *
 * Refuses to touch a production-looking database — see the guard below.
 */
import { Cause, Effect, Layer, ManagedRuntime } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { makeEmbeddedDbLayer, DbDevLive } from "~/lib/db/client.server"
import { seedDevFixtures } from "~/lib/db/seed-dev.server"

const dbPath = process.env.DURO_DB_PATH
const force = process.argv.includes("--force")

// These fixtures include a published API key and invented users. Getting them
// into a real database would be a security problem, not just untidy, so the
// bar to run against anything but a local PGlite directory is explicit.
if (process.env.NODE_ENV === "production" && !force) {
  console.error("Refusing to seed with NODE_ENV=production. Re-run with --force if this really is a dev database.")
  process.exit(1)
}
if (process.env.DATABASE_URL && !dbPath && !force) {
  console.error(
    "DATABASE_URL is set and DURO_DB_PATH is not — that points at a real Postgres, not a local dev store.\n" +
      "Set DURO_DB_PATH to the dev PGlite directory, or pass --force if you are certain.",
  )
  process.exit(1)
}

const DbLayer = dbPath ? makeEmbeddedDbLayer(dbPath) : DbDevLive

const program = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* seedDevFixtures(sql)
  // SqlError renders as a bare "Failed to execute statement"; the driver
  // message naming the column or constraint is only in the cause.
}).pipe(Effect.tapErrorCause((cause) => Effect.logError(Cause.pretty(cause))))

const runtime = ManagedRuntime.make(Layer.mergeAll(DbLayer))

runtime
  .runPromise(program)
  .then(async () => {
    console.log(`Seeded ${dbPath ?? "in-memory dev database"}.`)
    await runtime.dispose()
  })
  .catch(async (err) => {
    // SqlError's message is just "Failed to execute statement" — the driver
    // error that says which constraint or column is wrong hangs off `cause`.
    console.error(err instanceof Error ? err.message : String(err))
    const cause = (err as { cause?: unknown })?.cause
    if (cause) console.error(cause)
    await runtime.dispose()
    process.exit(1)
  })
