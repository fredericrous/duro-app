import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

/**
 * Vitest global setup: prepare a migrated-PGlite snapshot ONCE per run and
 * publish its path through DURO_PGLITE_SNAPSHOT (worker forks inherit the
 * env). Each DB-backed test file then restores the data dir instead of
 * booting an empty Postgres and replaying every migration — that replay was
 * the dominant per-file cost of the repo test tail.
 *
 * The cache key is a content hash of the migrations directory plus
 * client.server.ts (which owns the registration list), so editing history
 * regenerates the snapshot. Even a stale hit is safe: the migration runner
 * still runs per file and applies anything newer than the snapshot.
 */
export default async function globalSetup(): Promise<void> {
  const migrationsDir = resolve("app/lib/db/migrations/pg")
  const hash = createHash("sha256")
  for (const f of readdirSync(migrationsDir).sort()) {
    hash.update(f).update(readFileSync(join(migrationsDir, f)))
  }
  hash.update(readFileSync(resolve("app/lib/db/client.server.ts")))

  const cacheDir = resolve("node_modules/.cache/duro-pglite")
  const snapshotPath = join(cacheDir, `snap-${hash.digest("hex").slice(0, 16)}.tar.gz`)

  if (!existsSync(snapshotPath)) {
    const { dumpMigratedDataDir } = await import("~/lib/db/client.server")
    const bytes = await dumpMigratedDataDir()
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(snapshotPath, bytes)
    console.log(`[global-setup] built PGlite snapshot ${snapshotPath} (${(bytes.length / 1024).toFixed(0)}kB)`)
  }

  process.env.DURO_PGLITE_SNAPSHOT = snapshotPath
}
