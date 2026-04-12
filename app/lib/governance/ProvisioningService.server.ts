import { Cause, Context, Data, Effect, Exit, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import * as SqlError from "@effect/sql/SqlError"
import { MigrationsRan } from "~/lib/db/client.server"
import { PluginHost } from "~/lib/plugins/PluginHost.server"
import { decodeProvisioningJob, type ProvisioningJob } from "./types"

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class ProvisioningError extends Data.TaggedError("ProvisioningError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

const withErr = <A>(effect: Effect.Effect<A, SqlError.SqlError>, message: string) =>
  effect.pipe(Effect.mapError((e) => new ProvisioningError({ message, cause: e })))

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

export class ProvisioningService extends Context.Tag("ProvisioningService")<
  ProvisioningService,
  {
    /** Enqueues one provisioning_jobs row per matching ConnectedSystem. Returns the enqueued job IDs. */
    readonly onGrantActivated: (grantId: string) => Effect.Effect<string[], ProvisioningError>
    /** Symmetric; enqueues deprovision jobs. Returns the enqueued job IDs. */
    readonly onGrantRevoked: (grantId: string) => Effect.Effect<string[], ProvisioningError>
    readonly processNextPending: () => Effect.Effect<void, ProvisioningError, PluginHost>
    readonly processJob: (jobId: string) => Effect.Effect<void, ProvisioningError, PluginHost>
  }
>() {}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface ConnectedSystemConfig {
  readonly provisionUrl?: string
  readonly deprovisionUrl?: string
}

/** Find ALL active connected_systems for the grant's application. */
const findConnectedSystems = (sql: SqlClient.SqlClient, grantId: string) =>
  withErr(
    sql<{ id: string }>`
      SELECT DISTINCT cs.id
      FROM connected_systems cs
      JOIN applications a ON a.id = cs.application_id
      JOIN grants g ON (
        g.role_id IN (SELECT id FROM roles WHERE application_id = a.id)
        OR g.entitlement_id IN (SELECT id FROM entitlements WHERE application_id = a.id)
      )
      WHERE g.id = ${grantId}
        AND cs.status = 'active'
    `,
    "Failed to look up connected systems for grant",
  )

/** Insert a provisioning job and return its id. */
const insertJob = (
  sql: SqlClient.SqlClient,
  connectedSystemId: string,
  grantId: string,
  operation: "provision" | "deprovision",
) =>
  withErr(
    sql<{ id: string }>`
      INSERT INTO provisioning_jobs (connected_system_id, grant_id, operation)
      VALUES (${connectedSystemId}, ${grantId}, ${operation})
      RETURNING id
    `.pipe(Effect.map((rows) => rows[0].id)),
    `Failed to insert provisioning job (${operation})`,
  )

/** Execute the HTTP connector for a provisioning job. */
const executeHttpConnector = (
  config: ConnectedSystemConfig,
  operation: string,
  body: Record<string, unknown>,
) =>
  Effect.tryPromise({
    try: () => {
      const url = operation === "provision" ? config.provisionUrl : config.deprovisionUrl
      if (!url) throw new Error(`No ${operation} URL configured`)
      return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    },
    catch: (e) => new ProvisioningError({ message: `HTTP connector failed (${operation})`, cause: e }),
  }).pipe(
    Effect.flatMap((res) =>
      res.ok
        ? Effect.void
        : Effect.fail(
            new ProvisioningError({
              message: `HTTP connector returned ${res.status} (${operation})`,
            }),
          ),
    ),
  )

const markRunning = (sql: SqlClient.SqlClient, jobId: string) =>
  withErr(
    sql`
      UPDATE provisioning_jobs
      SET status = 'running', started_at = NOW(), attempts = attempts + 1
      WHERE id = ${jobId}
    `.pipe(Effect.asVoid),
    "Failed to mark job as running",
  )

const markCompleted = (sql: SqlClient.SqlClient, jobId: string) =>
  withErr(
    sql`
      UPDATE provisioning_jobs
      SET status = 'completed', completed_at = NOW()
      WHERE id = ${jobId}
    `.pipe(Effect.asVoid),
    "Failed to mark job as completed",
  )

const markFailed = (sql: SqlClient.SqlClient, jobId: string, errorMsg: string) =>
  withErr(
    sql`
      UPDATE provisioning_jobs
      SET status = 'failed', last_error = ${errorMsg}
      WHERE id = ${jobId}
    `.pipe(Effect.asVoid),
    "Failed to mark job as failed",
  )

/** Core processing logic shared by processNextPending and processJob. */
const processJobInternal = (sql: SqlClient.SqlClient, job: ProvisioningJob) =>
  Effect.gen(function* () {
    // Idempotency: already-terminal jobs are no-ops
    if (job.status === "completed" || job.status === "failed") {
      return
    }

    yield* markRunning(sql, job.id)

    // 2. Load connected system
    const systems = yield* withErr(
      sql<{ connectorType: string; config: unknown; pluginSlug: string | null }>`
        SELECT connector_type, config, plugin_slug FROM connected_systems WHERE id = ${job.connectedSystemId}
      `,
      "Failed to load connected system",
    )
    if (systems.length === 0) {
      return yield* new ProvisioningError({
        message: `Connected system ${job.connectedSystemId} not found`,
      })
    }
    const system = systems[0]
    const config: ConnectedSystemConfig =
      typeof system.config === "string"
        ? (JSON.parse(system.config) as ConnectedSystemConfig)
        : ((system.config ?? {}) as ConnectedSystemConfig)

    const connectorType = system.connectorType ?? "http"

    // 3. Dispatch on connector_type
    const dispatchEffect: Effect.Effect<void, ProvisioningError, PluginHost> =
      connectorType === "plugin" && system.pluginSlug
        ? Effect.gen(function* () {
            const host = yield* PluginHost
            const op =
              job.operation === "provision"
                ? host.runProvision(system.pluginSlug!, job.grantId, job.connectedSystemId)
                : host.runDeprovision(system.pluginSlug!, job.grantId, job.connectedSystemId)
            yield* op.pipe(
              Effect.mapError((e) => new ProvisioningError({ message: e.message, cause: e })),
            )
          })
        : connectorType === "http"
          ? (() => {
              // Legacy HTTP connector — loads grant details for the request body
              const loadAndPost = Effect.gen(function* () {
                const grants = yield* withErr(
                  sql<{
                    principalId: string
                    roleId: string | null
                    entitlementId: string | null
                    resourceId: string | null
                  }>`SELECT principal_id, role_id, entitlement_id, resource_id FROM grants WHERE id = ${job.grantId}`,
                  "Failed to load grant",
                )
                const grant = grants[0]
                yield* executeHttpConnector(config, job.operation, {
                  grantId: job.grantId,
                  principalId: grant?.principalId ?? null,
                  roleId: grant?.roleId ?? null,
                  entitlementId: grant?.entitlementId ?? null,
                  resourceId: grant?.resourceId ?? null,
                  operation: job.operation,
                })
              })
              return loadAndPost as Effect.Effect<void, ProvisioningError, never>
            })()
          : Effect.fail(
              new ProvisioningError({ message: `Connector type not implemented: ${connectorType}` }),
            )

    // 5. Run + persist terminal status via onExit so cleanup is uninterruptible.
    //    If the fiber is interrupted mid-dispatch, the job still gets marked
    //    'failed' instead of being stuck in 'running' forever.
    //
    //    Both cleanup branches swallow their own errors: onExit callbacks
    //    MUST return Effect<_, never, _> so cleanup failures never override
    //    the original exit cause. Failures inside the cleanup are logged
    //    (via withErr) and discarded.
    yield* dispatchEffect.pipe(
      Effect.onExit((exit) =>
        Exit.isSuccess(exit)
          ? markCompleted(sql, job.id).pipe(Effect.catchAll(() => Effect.void))
          : markFailed(sql, job.id, Cause.pretty(exit.cause)).pipe(
              Effect.tap(() =>
                Effect.logError("provisioning job failed").pipe(
                  Effect.annotateLogs({
                    jobId: job.id,
                    connectorType,
                    operation: job.operation,
                    cause: Cause.pretty(exit.cause),
                  }),
                ),
              ),
              Effect.catchAll(() => Effect.void),
            ),
      ),
    )
  })

// ---------------------------------------------------------------------------
// Live layer
// ---------------------------------------------------------------------------

export const ProvisioningServiceLive = Layer.effect(
  ProvisioningService,
  Effect.gen(function* () {
    yield* MigrationsRan
    const sql = yield* SqlClient.SqlClient

    const enqueueForAllSystems = (grantId: string, operation: "provision" | "deprovision") =>
      Effect.gen(function* () {
        const rows = yield* findConnectedSystems(sql, grantId)
        const jobIds: string[] = []
        for (const row of rows) {
          const id = yield* insertJob(sql, row.id, grantId, operation)
          jobIds.push(id)
        }
        return jobIds
      })

    const loadJob = (jobId: string) =>
      withErr(
        sql`SELECT * FROM provisioning_jobs WHERE id = ${jobId}`,
        "Failed to fetch job",
      ).pipe(
        Effect.flatMap((rows) =>
          rows.length === 0
            ? new ProvisioningError({ message: `Job ${jobId} not found` })
            : Effect.try({
                try: () => decodeProvisioningJob(rows[0]) as ProvisioningJob,
                catch: (e) => new ProvisioningError({ message: "Failed to decode job row", cause: e }),
              }),
        ),
      )

    return {
      onGrantActivated: (grantId) => enqueueForAllSystems(grantId, "provision"),

      onGrantRevoked: (grantId) => enqueueForAllSystems(grantId, "deprovision"),

      processNextPending: () =>
        Effect.gen(function* () {
          const rows = yield* withErr(
            sql`
              SELECT * FROM provisioning_jobs
              WHERE status = 'pending'
              ORDER BY created_at ASC
              LIMIT 1
            `,
            "Failed to fetch next pending job",
          )
          if (rows.length === 0) return
          const job = yield* Effect.try({
            try: () => decodeProvisioningJob(rows[0]) as ProvisioningJob,
            catch: (e) => new ProvisioningError({ message: "Failed to decode job row", cause: e }),
          })
          yield* processJobInternal(sql, job)
        }),

      processJob: (jobId) =>
        Effect.gen(function* () {
          const job = yield* loadJob(jobId)
          yield* processJobInternal(sql, job)
        }),
    }
  }),
)

// ---------------------------------------------------------------------------
// Dev layer — logs and does nothing
// ---------------------------------------------------------------------------

export const ProvisioningServiceDev = Layer.succeed(ProvisioningService, {
  onGrantActivated: (grantId) =>
    Effect.log("[ProvisioningService/dev] onGrantActivated").pipe(
      Effect.annotateLogs({ grantId }),
      Effect.as([] as string[]),
    ),

  onGrantRevoked: (grantId) =>
    Effect.log("[ProvisioningService/dev] onGrantRevoked").pipe(
      Effect.annotateLogs({ grantId }),
      Effect.as([] as string[]),
    ),

  processNextPending: () =>
    Effect.log("[ProvisioningService/dev] processNextPending (no-op)").pipe(Effect.asVoid),

  processJob: (jobId) =>
    Effect.log("[ProvisioningService/dev] processJob (no-op)").pipe(
      Effect.annotateLogs({ jobId }),
      Effect.asVoid,
    ),
})
