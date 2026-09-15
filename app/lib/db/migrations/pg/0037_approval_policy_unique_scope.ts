import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

/**
 * One approval policy per (application, scope) — the shape the admin gate
 * board edits and the request workflow resolves.
 *
 * `findApprovalPolicy` already picks the most specific scope with `LIMIT 1`,
 * so two rows on the same scope were never both live; which one won was
 * undefined. Before the UI existed rows only came from SQL by hand, so the
 * dedupe below is a safety net: keep the most recently updated row per scope
 * (ties broken by id), then add the unique index that `upsert` relies on
 * (`ON CONFLICT (application_id, scope_type, COALESCE(scope_id, ''))`).
 * `COALESCE` folds the NULL scope_id of application-wide policies, which a
 * plain UNIQUE constraint would treat as always-distinct.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`DELETE FROM approval_policies a
             USING approval_policies b
             WHERE a.application_id = b.application_id
               AND a.scope_type = b.scope_type
               AND COALESCE(a.scope_id, '') = COALESCE(b.scope_id, '')
               AND (a.updated_at, a.id) < (b.updated_at, b.id)`
  yield* sql`CREATE UNIQUE INDEX IF NOT EXISTS ux_approval_policies_scope
             ON approval_policies (application_id, scope_type, COALESCE(scope_id, ''))`
})
