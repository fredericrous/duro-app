/**
 * Worker thread that runs PGlite outside Metro's bundler.
 * Uses worker_threads (shared memory) instead of child_process (IPC) for speed.
 */
import { parentPort } from "node:worker_threads"
import { PGlite } from "@electric-sql/pglite"

const db = new PGlite()
await db.waitReady

parentPort.on("message", async (msg) => {
  try {
    const result = await db.query(msg.sql, msg.params)
    parentPort.postMessage({
      id: msg.id,
      result: { rows: result.rows, fields: result.fields, affectedRows: result.affectedRows },
    })
  } catch (e) {
    parentPort.postMessage({ id: msg.id, error: e.message })
  }
})

parentPort.postMessage({ ready: true })
