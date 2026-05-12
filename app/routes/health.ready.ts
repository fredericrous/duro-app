import { Effect } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { runEffect } from "~/lib/runtime.server"

// Readiness probe: separate from /health (which doubles as the invite-flow
// return-URL handler) so kubelet can use this for actual DB-aware
// readiness. A wedged pool drops the pod from the Service after
// the chart's failureThreshold and triggers recovery — instead of
// silently 500'ing every request.
export async function loader() {
  const ping = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`SELECT 1`
  }).pipe(Effect.timeout("3 seconds"))

  try {
    await runEffect(ping)
    return Response.json({ status: "ready" })
  } catch (e) {
    return Response.json({ status: "not_ready", error: String(e) }, { status: 503 })
  }
}
