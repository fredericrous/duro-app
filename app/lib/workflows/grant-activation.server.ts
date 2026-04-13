import { Cause, Context, Effect } from "effect"
import { ProvisioningService, type ProvisioningError } from "~/lib/governance/ProvisioningService.server"
import type { PluginHost } from "~/lib/plugins/PluginHost.server"

type ActivationDeps = ProvisioningService | PluginHost

/**
 * Fork a processing job as a background daemon fiber. Critical: use
 * forkDaemon NOT fork. A plain `Effect.fork` attaches to the current fiber
 * scope and gets interrupted when the caller (the route action) completes,
 * which is typically hundreds of milliseconds before the LDAP round-trip
 * finishes. forkDaemon attaches to the global scope and survives.
 *
 * Errors from the forked fiber are lost by design (fire-and-forget), so
 * tapError logs them before the fork so they still show up in telemetry.
 */
const forkProcessJob = (provisioning: Context.Tag.Service<typeof ProvisioningService>, jobId: string) =>
  provisioning.processJob(jobId).pipe(
    Effect.tapErrorCause((cause) =>
      Effect.logError("provisioning job failed").pipe(
        Effect.annotateLogs({
          jobId,
          component: "grant-activation",
          cause: Cause.pretty(cause),
        }),
      ),
    ),
    Effect.forkDaemon,
  )

/**
 * Shared activation workflow — every grant creation path (quick-grant in the
 * admin UI, access-request approval, future paths) calls this so jobs are
 * both enqueued AND processed. Invariants 2 and 3 from the plan.
 *
 * Enqueues one provisioning_jobs row per matching ConnectedSystem, then forks
 * processing in the background so the caller returns immediately.
 */
export const activateGrant = (grantId: string): Effect.Effect<void, ProvisioningError, ActivationDeps> =>
  Effect.gen(function* () {
    const provisioning = yield* ProvisioningService
    const jobIds = yield* provisioning.onGrantActivated(grantId)
    for (const jobId of jobIds) {
      yield* forkProcessJob(provisioning, jobId)
    }
  })

/**
 * Symmetric deactivation workflow. Assumes the grant has already been marked
 * revoked in the DB (by the caller); this only handles the provisioning side.
 */
export const deactivateGrant = (grantId: string): Effect.Effect<void, ProvisioningError, ActivationDeps> =>
  Effect.gen(function* () {
    const provisioning = yield* ProvisioningService
    const jobIds = yield* provisioning.onGrantRevoked(grantId)
    for (const jobId of jobIds) {
      yield* forkProcessJob(provisioning, jobId)
    }
  })
