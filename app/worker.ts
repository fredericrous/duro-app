import http from "node:http"
import { ManagedRuntime } from "effect"
import { WorkerLayer } from "./lib/services/WorkerLayer.server"
import { reconcileLoop } from "./lib/reconciler.server"

process.env.OTEL_SERVICE_NAME ??= "duro-worker"

const runtime = ManagedRuntime.make(WorkerLayer)

http
  .createServer((_, res) => {
    res.writeHead(200)
    res.end("ok")
  })
  .listen(3001, () => console.log("[worker] health on :3001"))

console.log("[worker] starting reconcile loop")
runtime.runPromise(reconcileLoop).catch((e) => {
  console.error("[worker] fatal:", e)
  process.exit(1)
})
