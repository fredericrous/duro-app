import { Effect } from "effect"
import { ProvisioningService, type ProvisioningError } from "~/lib/governance/ProvisioningService.server"
import type { LdapConnector } from "~/lib/governance/connectors/LdapConnector.server"

type ActivationDeps = ProvisioningService | LdapConnector

/**
 * Shared activation workflow — every grant creation path (quick-grant in the
 * admin UI, access-request approval, future paths) calls this so jobs are
 * both enqueued AND processed. Invariants 2 and 3 from the plan.
 *
 * Enqueues one provisioning_jobs row per matching ConnectedSystem, then forks
 * processing in the background so the caller returns immediately.
 */
export const activateGrant = (
  grantId: string,
): Effect.Effect<void, ProvisioningError, ActivationDeps> =>
  Effect.gen(function* () {
    const provisioning = yield* ProvisioningService
    const jobIds = yield* provisioning.onGrantActivated(grantId)
    for (const jobId of jobIds) {
      yield* Effect.fork(provisioning.processJob(jobId))
    }
  })

/**
 * Symmetric deactivation workflow. Assumes the grant has already been marked
 * revoked in the DB (by the caller); this only handles the provisioning side.
 */
export const deactivateGrant = (
  grantId: string,
): Effect.Effect<void, ProvisioningError, ActivationDeps> =>
  Effect.gen(function* () {
    const provisioning = yield* ProvisioningService
    const jobIds = yield* provisioning.onGrantRevoked(grantId)
    for (const jobId of jobIds) {
      yield* Effect.fork(provisioning.processJob(jobId))
    }
  })
