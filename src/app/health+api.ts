import { Effect, Config, Layer, ManagedRuntime } from "effect"
import * as PgClient from "@effect/sql-pg/PgClient"
import * as SqlClient from "@effect/sql/SqlClient"

const PgLayer = Layer.unwrapEffect(Config.redacted("DATABASE_URL").pipe(Effect.map((url) => PgClient.layer({ url }))))

const runtime = ManagedRuntime.make(PgLayer)

export async function GET() {
  try {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql`SELECT NOW() as time`
        return { ok: true, time: String(rows[0]?.time) }
      }),
    )
    return Response.json(result)
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
