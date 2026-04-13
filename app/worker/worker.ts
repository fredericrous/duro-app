/**
 * Durable provisioning worker — single-replica Deployment that polls
 * provisioning_jobs for pending and retriable-failed rows.
 *
 * Complements the web pod's forkDaemon fast path: the web pod enqueues
 * and forks processing for immediate grants; the worker is the safety net
 * for stranded jobs (pod crash, fiber interrupt, transient LDAP failures).
 *
 * Runs a simple poll loop + a tiny HTTP health server for k8s probes.
 */

import { Effect, Layer, Schedule } from "effect"
import * as Http from "node:http"
import { ProvisioningService, ProvisioningServiceLive } from "~/lib/governance/ProvisioningService.server"
import { PluginHost } from "~/lib/plugins/PluginHost.server"
import { PluginHostLive } from "~/lib/plugins/PluginHost.server"
import { PluginRegistryLive } from "~/lib/plugins/PluginRegistry.server"
import { DbLive } from "~/lib/db/client.server"
import { PrincipalRepoLive } from "~/lib/governance/PrincipalRepo.server"
import { ApplicationRepoLive } from "~/lib/governance/ApplicationRepo.server"
import { RbacRepoLive } from "~/lib/governance/RbacRepo.server"
import { GrantRepoLive } from "~/lib/governance/GrantRepo.server"
import { ConnectedSystemRepoLive } from "~/lib/governance/ConnectedSystemRepo.server"
import { ConnectorMappingRepoLive } from "~/lib/governance/ConnectorMappingRepo.server"
import { AuditServiceLive } from "~/lib/governance/AuditService.server"
import { LldapClientLive } from "~/lib/services/LldapClient.server"
import { FetchHttpClient } from "@effect/platform"
import { OtelLayer } from "~/lib/telemetry.server"
import * as SqlClient from "@effect/sql/SqlClient"

// ---------------------------------------------------------------------------
// Layer composition — same services as AppLayer but without web/oidc/email
// ---------------------------------------------------------------------------

const GovernanceRepos = Layer.mergeAll(
  PrincipalRepoLive,
  RbacRepoLive,
  GrantRepoLive,
  ConnectedSystemRepoLive,
  ConnectorMappingRepoLive,
)

const PluginHostWired = PluginHostLive.pipe(
  Layer.provide(
    Layer.mergeAll(GovernanceRepos, ApplicationRepoLive, PluginRegistryLive, LldapClientLive, AuditServiceLive),
  ),
)

const WorkerLayer = Layer.mergeAll(
  GovernanceRepos,
  ApplicationRepoLive,
  AuditServiceLive,
  ProvisioningServiceLive,
  PluginRegistryLive,
  PluginHostWired,
).pipe(Layer.provideMerge(DbLive), Layer.provide(OtelLayer), Layer.provide(FetchHttpClient.layer))

// ---------------------------------------------------------------------------
// Poll loop
// ---------------------------------------------------------------------------

// Poll interval — Effect Schedule.spaced accepts DurationInput strings

const pollOnce = Effect.gen(function* () {
  const provisioning = yield* ProvisioningService
  const sql = yield* SqlClient.SqlClient

  // 1. Process the next pending job
  yield* provisioning.processNextPending().pipe(
    Effect.tapErrorCause((cause) =>
      Effect.logError("worker: processNextPending failed").pipe(Effect.annotateLogs({ cause: String(cause) })),
    ),
    Effect.catchAll(() => Effect.void),
  )

  // 2. Retry failed jobs older than 5 minutes
  const staleJobs = yield* sql`
    SELECT id FROM provisioning_jobs
    WHERE status = 'failed'
      AND created_at < NOW() - INTERVAL '300 seconds'
      AND attempts < 5
    ORDER BY created_at ASC
    LIMIT 3
  `.pipe(Effect.catchAll(() => Effect.succeed([] as Array<{ id: string }>)))

  for (const job of staleJobs) {
    yield* sql`UPDATE provisioning_jobs SET status = 'pending' WHERE id = ${(job as { id: string }).id}`.pipe(
      Effect.catchAll(() => Effect.void),
    )
  }

  // 3. Recover stale 'running' jobs (stuck > 5 min, likely from a crashed pod)
  yield* sql`
    UPDATE provisioning_jobs
    SET status = 'pending', last_error = 'recovered from stale running state'
    WHERE status = 'running'
      AND started_at < NOW() - INTERVAL '300 seconds'
  `.pipe(Effect.catchAll(() => Effect.void))
})

const pollLoop = pollOnce.pipe(
  Effect.repeat(Schedule.spaced("30 seconds")),
  Effect.tapErrorCause((cause) =>
    Effect.logError("worker poll loop crashed").pipe(Effect.annotateLogs({ cause: String(cause) })),
  ),
  Effect.catchAll(() => Effect.void),
)

// ---------------------------------------------------------------------------
// Health server (for k8s liveness/readiness probes)
// ---------------------------------------------------------------------------

const HEALTH_PORT = parseInt(process.env.WORKER_HEALTH_PORT ?? "3001", 10)

const startHealthServer = Effect.sync(() => {
  const server = Http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" })
    res.end("ok")
  })
  server.listen(HEALTH_PORT, () => {
    console.log(`worker health server on :${HEALTH_PORT}`)
  })
})

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = Effect.gen(function* () {
  yield* Effect.log("duro worker starting")
  yield* startHealthServer
  yield* pollLoop
})

Effect.runFork(
  main.pipe(
    Effect.provide(WorkerLayer),
    Effect.tapErrorCause((cause) => Effect.logError("worker fatal", { cause: String(cause) })),
  ),
)
