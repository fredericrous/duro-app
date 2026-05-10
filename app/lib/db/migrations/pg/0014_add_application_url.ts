import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  // Where the user goes when they click an app card on the home grid. NULL is
  // valid: governance can manage access for an app that has no web frontend
  // (e.g. an SSH service or an SMB share). The UI surfaces a "no launch URL"
  // hint when null.
  yield* sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS url TEXT`
})
