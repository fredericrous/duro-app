// @vitest-environment node
import { describe, expect, it } from "vitest"
import { Effect } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assertUsableDataDir, makeEmbeddedDbLayer } from "./client.server"

describe("makeEmbeddedDbLayer — file-backed PGlite (chart sqlite mode)", () => {
  it("runs migrations against a file-backed store and persists across restarts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "duro-embed-"))
    try {
      // First boot: layer construction runs all migrations (incl. the theme
      // column from 0029), then we write a row.
      await Effect.runPromise(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* sql`INSERT INTO user_preferences (username, locale, updated_at, theme)
                     VALUES ('embed-test', 'en', NOW(), 'light')`
        }).pipe(Effect.provide(makeEmbeddedDbLayer(dir)), Effect.scoped),
      )

      // Second boot: a fresh layer over the SAME directory sees the persisted
      // row — proving the data survived and the file-backed store is real.
      const rows = await Effect.runPromise(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql`SELECT theme FROM user_preferences WHERE username = 'embed-test'`
        }).pipe(Effect.provide(makeEmbeddedDbLayer(dir)), Effect.scoped),
      )

      expect((rows[0] as { theme?: string }).theme).toBe("light")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)
})

describe("assertUsableDataDir", () => {
  it("rejects a path that is a file, naming the path and the likely cause", () => {
    // The pre-Postgres DURO_DB_PATH pointed at a SQLite file; a leftover one
    // otherwise reaches PGlite and aborts in WASM with a bare exit(1).
    const dir = mkdtempSync(join(tmpdir(), "duro-datadir-"))
    const file = join(dir, "duro-dev.sqlite")
    writeFileSync(file, "SQLite format 3\0")
    try {
      expect(() => assertUsableDataDir(file)).toThrow(/must point at a directory/)
      expect(() => assertUsableDataDir(file)).toThrow(/duro-dev\.sqlite/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("accepts an existing directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "duro-datadir-"))
    try {
      expect(() => assertUsableDataDir(dir)).not.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("accepts a path that does not exist yet — PGlite creates it", () => {
    const dir = mkdtempSync(join(tmpdir(), "duro-datadir-"))
    try {
      expect(() => assertUsableDataDir(join(dir, "not-created-yet"))).not.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
