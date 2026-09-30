import { Effect } from "effect"
import { AppSyncService, type ConditionalSyncResult } from "./AppSyncService.server"

/**
 * The worker's unattended app sync: what the "Sync from cluster" button does,
 * minus the click.
 *
 * Every tick asks the operator for its app list with the ETag of the last one
 * seen; unchanged is a 304 and nothing else happens, so a one-minute cadence
 * costs next to nothing. Every `forceEvery` ticks the ETag is dropped and a
 * full sync runs anyway, which also repairs anything changed in duro by hand.
 * The guards against syncing a bad list (empty, or one that would disable many
 * apps at once) live in AppSyncService itself, so the button has them too.
 *
 * A failed tick is logged and retried on the next one; it never stops the
 * worker. The ETag only advances on a successful sync, so a sync that failed
 * part-way is simply attempted again.
 */
export interface AutoSyncOptions {
  /** Full sync every N ticks regardless of the ETag. */
  readonly forceEvery: number
}

export const makeAppAutoSync = (options: AutoSyncOptions) => {
  let etag: string | null = null
  let ticks = 0

  return Effect.gen(function* () {
    const sync = yield* AppSyncService
    const forced = ticks % options.forceEvery === 0
    ticks++
    const result: ConditionalSyncResult = yield* sync.syncIfChanged(forced ? null : etag)
    if (!result.changed) return result
    etag = result.etag
    const r = result.result
    if (r.created || r.updated || r.disabled || r.disableRefused) {
      yield* Effect.log(
        `app sync: ${r.created} created, ${r.updated} updated, ${r.disabled} disabled` +
          (r.disableRefused ? `, ${r.disableRefused} disable(s) REFUSED` : "") +
          ` (${r.total} apps)`,
      )
    }
    return result
  }).pipe(
    Effect.tapErrorCause((cause) =>
      Effect.logError("worker: app sync failed").pipe(Effect.annotateLogs({ cause: String(cause) })),
    ),
    Effect.catchAllCause(() => Effect.succeed<ConditionalSyncResult>({ changed: false })),
  )
}
