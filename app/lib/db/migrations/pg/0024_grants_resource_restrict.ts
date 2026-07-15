import * as SqlClient from "@effect/sql/SqlClient"
import { Effect, Schedule } from "effect"

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
 * Postgres has no `ALTER CONSTRAINT` to change a FK's ON DELETE action, so the
 * change is a DROP + re-ADD. Both statements need a strong lock on `grants`
 * (ACCESS EXCLUSIVE for DROP, SHARE ROW EXCLUSIVE for ADD). On a live/just-
 * restored database something else may already hold a conflicting lock on
 * `grants` (e.g. an anti-wraparound autovacuum right after a clone bootstraps).
 * Without a bound, the DDL blocks *forever* — and because migrations run during
 * AppLayer build on first boot, that hangs the whole pod (readiness never turns
 * green). So:
 *   - `SET LOCAL lock_timeout` bounds how long we wait for the lock, turning an
 *     unbounded hang into a fast, retryable failure that never wedges boot.
 *   - a short bounded retry rides out transient contention (autovacuum finishing).
 *   - the DROP + ADD run in one transaction so we never leave `grants` with no
 *     FK at all if the retry gives up.
 *
 * The constraint is added `NOT VALID`: that skips only the one-time validation
 * scan of pre-existing rows, NOT the fix. `ON DELETE RESTRICT` is installed
 * immediately and fires for every referencing row, so a resource with any live
 * grant still cannot be deleted — the escalation is closed. (A later migration
 * can `VALIDATE CONSTRAINT` once existing rows are known clean.)
 */
const swap = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`SET LOCAL lock_timeout = '4s'`
      yield* sql`ALTER TABLE grants DROP CONSTRAINT IF EXISTS grants_resource_id_fkey`
      yield* sql`
        ALTER TABLE grants
        ADD CONSTRAINT grants_resource_id_fkey
        FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE RESTRICT NOT VALID
      `
    }),
  )
})

// Retry a handful of times for transient lock contention, then give up fast
// rather than hang boot. ~5 attempts * (up to 4s lock wait + 3s spacing) keeps
// the worst case well under the readiness window.
export default swap.pipe(Effect.retry(Schedule.intersect(Schedule.spaced("3 seconds"), Schedule.recurs(4))))
