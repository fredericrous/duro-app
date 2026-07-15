import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

/**
 * grants.resource_id was `ON DELETE SET NULL`. The AuthzEngine treats a NULL
 * resource_id as an APP-WIDE grant, so deleting a resource silently *widened*
 * every grant scoped to it from "this resource" to "the whole application" — a
 * privilege escalation. Switch to RESTRICT so a resource with active grants
 * cannot be deleted out from under them; the grants must be revoked first
 * (which deprovisions the downstream access). CASCADE was rejected because it
 * would hard-delete the grant rows (losing the soft-delete/audit history) and
 * leave the downstream access orphaned with no deprovision.
 *
 * The inline FK from 0008 is named `grants_resource_id_fkey` (Postgres default
 * for an inline column reference).
 *
 * The constraint is added `NOT VALID` on purpose. A plain `ADD CONSTRAINT ...
 * FOREIGN KEY` runs a full-table validation scan of `grants` under a lock to
 * prove every existing row has a parent — on a populated prod table that scan
 * is what previously wedged the migration (boot hung, /health/ready stuck 503).
 * `NOT VALID` skips only that one-time scan of pre-existing rows; it does NOT
 * weaken the fix. The `ON DELETE RESTRICT` referential action is installed
 * immediately and fires for *every* referencing row (validated or not), so a
 * resource with any live grant still cannot be deleted — the escalation is
 * closed. New/updated grant rows are also checked against `resources` right
 * away. (A later migration can `VALIDATE CONSTRAINT` once existing rows are
 * known clean; that is a separate integrity concern, not this security fix.)
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`ALTER TABLE grants DROP CONSTRAINT IF EXISTS grants_resource_id_fkey`
  yield* sql`
    ALTER TABLE grants
    ADD CONSTRAINT grants_resource_id_fkey
    FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE RESTRICT NOT VALID
  `
})
