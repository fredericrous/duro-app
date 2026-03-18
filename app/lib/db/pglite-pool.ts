/**
 * Adapter that wraps PGlite in a pg.Pool-compatible interface
 * for use with @effect/sql-pg's layerFromPool.
 *
 * vitest: loads PGlite directly (no Metro).
 * Metro dev: runs PGlite in a worker thread to avoid Metro breaking Emscripten's require().
 */
import type { PGlite } from "@electric-sql/pglite"
import { EventEmitter } from "node:events"
import { join } from "node:path"

// ---------------------------------------------------------------------------
// Query backend interface
// ---------------------------------------------------------------------------

interface QueryResult {
  rows: any[]
  fields: any[]
  affectedRows?: number
}

interface PgLiteBackend {
  query(sql: string, params?: any[]): Promise<QueryResult>
  close(): Promise<void>
}

// ---------------------------------------------------------------------------
// Direct backend (vitest)
// ---------------------------------------------------------------------------

class DirectBackend implements PgLiteBackend {
  constructor(private pglite: PGlite) {}
  query(sql: string, params?: any[]) {
    return this.pglite.query(sql, params)
  }
  close() {
    return this.pglite.close()
  }
}

// ---------------------------------------------------------------------------
// Worker thread backend (Metro dev — fast, shared memory)
// ---------------------------------------------------------------------------

class WorkerBackend implements PgLiteBackend {
  private worker: import("node:worker_threads").Worker
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  private nextId = 0
  ready: Promise<void>

  constructor() {
    // Dynamic require to avoid Metro bundling worker_threads
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Worker } = require("node:worker_threads") as typeof import("node:worker_threads")
    const workerPath = join(process.cwd(), "app", "lib", "db", "pglite-worker.mjs")
    this.worker = new Worker(workerPath)

    this.ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("PGlite worker timed out")), 15000)
      this.worker.once("message", (msg: any) => {
        if (msg.ready) {
          clearTimeout(timeout)
          resolve()
        }
      })
      this.worker.once("error", (e) => {
        clearTimeout(timeout)
        reject(e)
      })
    })

    this.worker.on("message", (msg: any) => {
      if (msg.id == null) return
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error))
      else p.resolve(msg.result)
    })
  }

  async query(sql: string, params?: any[]): Promise<QueryResult> {
    await this.ready
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ id, sql, params })
    })
  }

  async close() {
    await this.worker.terminate()
  }
}

// ---------------------------------------------------------------------------
// Pool adapter
// ---------------------------------------------------------------------------

class PgliteClient extends EventEmitter {
  constructor(private backend: PgLiteBackend) {
    super()
  }

  query(
    textOrConfig: string | { text: string; values?: any[]; rowMode?: string },
    paramsOrCallback?: any[] | ((err: Error | null, result: any) => void),
    callback?: (err: Error | null, result: any) => void,
  ) {
    let text: string
    let params: any[] | undefined
    let rowMode: string | undefined
    let cb: (err: Error | null, result: any) => void

    if (typeof textOrConfig === "object") {
      text = textOrConfig.text
      params = textOrConfig.values
      rowMode = textOrConfig.rowMode
      cb = paramsOrCallback as (err: Error | null, result: any) => void
    } else {
      text = textOrConfig
      if (typeof paramsOrCallback === "function") {
        cb = paramsOrCallback
      } else {
        params = paramsOrCallback
        cb = callback!
      }
    }

    this.backend
      .query(text, params)
      .then((result) => {
        const rows = rowMode === "array" ? result.rows.map((r: any) => Object.values(r)) : result.rows
        cb(null, {
          rows,
          fields: result.fields,
          rowCount: result.affectedRows ?? result.rows.length,
        })
      })
      .catch((err) => cb(err, null))
  }

  release(_err?: Error) {}
}

class PglitePool extends EventEmitter {
  readonly options = {
    connectionString: undefined,
    host: "pglite",
    port: 0,
    database: "pglite",
    user: "pglite",
    password: undefined,
    ssl: false,
    application_name: "pglite-test",
    types: undefined,
  }

  constructor(private backend: PgLiteBackend) {
    super()
  }

  connect(callback: (err: Error | null, client: any, release: () => void) => void) {
    const client = new PgliteClient(this.backend)
    callback(null, client, () => {})
  }

  async end() {
    await this.backend.close()
  }
}

// ---------------------------------------------------------------------------
// Factory — shared singleton across Metro bundles
// ---------------------------------------------------------------------------

const GLOBAL_KEY = "__pglite_backend__"
const isVitest = typeof process !== "undefined" && process.env.VITEST === "true"

export async function createPglitePool() {
  let backend: PgLiteBackend

  if (isVitest) {
    // vitest — load PGlite directly, each test suite gets its own instance
    const { PGlite: PGliteCtor } = await import("@electric-sql/pglite")
    const pglite = new PGliteCtor()
    await pglite.waitReady
    backend = new DirectBackend(pglite)
  } else if ((globalThis as any)[GLOBAL_KEY]) {
    // Metro — reuse existing worker across bundles
    backend = (globalThis as any)[GLOBAL_KEY]
  } else {
    // Metro — spawn worker thread
    const wb = new WorkerBackend()
    await wb.ready
    ;(globalThis as any)[GLOBAL_KEY] = wb
    backend = wb
  }

  return new PglitePool(backend) as any
}
