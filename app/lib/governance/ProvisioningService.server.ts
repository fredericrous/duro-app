import { Context, Effect, Data, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import * as SqlError from "@effect/sql/SqlError"
import { MigrationsRan } from "~/lib/db/client.server"
import { LdapConnector } from "./connectors/LdapConnector.server"

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
    readonly processNextPending: () => Effect.Effect<void, ProvisioningError, LdapConnector>
    readonly processJob: (jobId: string) => Effect.Effect<void, ProvisioningError, LdapConnector>
  }
>() {}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Find ALL active connected_systems for the grant's application. */
const findConnectedSystems = (sql: SqlClient.SqlClient, grantId: string) =>
  withErr(
    sql`
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
    sql`
      INSERT INTO provisioning_jobs (connected_system_id, grant_id, operation)
      VALUES (${connectedSystemId}, ${grantId}, ${operation})
      RETURNING id
    `.pipe(Effect.map((rows) => (rows[0] as { id: string }).id)),
    `Failed to insert provisioning job (${operation})`,
  )

/** Execute the HTTP connector for a provisioning job. */
const executeHttpConnector = (
  config: { provisionUrl?: string; deprovisionUrl?: string },
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

/** Core processing logic shared by processNextPending and processJob. */
const processJobInternal = (sql: SqlClient.SqlClient, job: Record<string, any>) =>
  Effect.gen(function* () {
    const jobId = job.id as string

    // Idempotency: already-terminal jobs are no-ops
    if (job.status === "completed" || job.status === "failed") {
      return
    }

    // 1. Mark running
    yield* withErr(
      sql`
        UPDATE provisioning_jobs
        SET status = 'running', started_at = NOW(), attempts = attempts + 1
        WHERE id = ${jobId}
      `.pipe(Effect.asVoid),
      "Failed to mark job as running",
    )

    // 2. Load connected system config
    const systems = yield* withErr(
      sql`SELECT * FROM connected_systems WHERE id = ${job.connectedSystemId}`,
      "Failed to load connected system",
    )
    if (systems.length === 0) {
      return yield* Effect.fail(
        new ProvisioningError({ message: `Connected system ${job.connectedSystemId} not found` }),
      )
    }
    const system = systems[0] as Record<string, any>
    const config = typeof system.config === "string" ? JSON.parse(system.config) : (system.config ?? {})

    // 3. Load grant details for the HTTP connector body (only used by http path)
    const grants = yield* withErr(sql`SELECT * FROM grants WHERE id = ${job.grantId}`, "Failed to load grant")
    const grant = (grants[0] ?? {}) as Record<string, any>

    const body = {
      grantId: job.grantId,
      principalId: grant.principalId ?? null,
      roleId: grant.roleId ?? null,
      entitlementId: grant.entitlementId ?? null,
      resourceId: grant.resourceId ?? null,
      operation: job.operation,
    }

    // 4. Dispatch based on connector_type
    const connectorType = (system.connectorType ?? "http") as string

    const dispatchEffect: Effect.Effect<void, ProvisioningError, LdapConnector> = (() => {
      if (connectorType === "http") {
        return executeHttpConnector(config, job.operation, body)
      }
      if (connectorType === "ldap") {
        return Effect.gen(function* () {
          const ldap = yield* LdapConnector
          if (job.operation === "provision") {
            yield* ldap
              .provisionGrant(job.grantId)
              .pipe(Effect.mapError((e) => new ProvisioningError({ message: e.message, cause: e })))
          } else {
            yield* ldap
              .deprovisionGrant(job.grantId)
              .pipe(Effect.mapError((e) => new ProvisioningError({ message: e.message, cause: e })))
          }
        })
      }
      return Effect.fail(
        new ProvisioningError({ message: `Connector type not implemented: ${connectorType}` }),
      )
    })()

    const result = yield* Effect.match(dispatchEffect, {
      onFailure: (err) => ({ ok: false as const, error: err }),
      onSuccess: () => ({ ok: true as const, error: null }),
    })

    // 5. Update final status
    if (result.ok) {
      yield* withErr(
        sql`
          UPDATE provisioning_jobs
          SET status = 'completed', completed_at = NOW()
          WHERE id = ${jobId}
        `.pipe(Effect.asVoid),
        "Failed to mark job as completed",
      )
    } else {
      const errorMsg = result.error instanceof ProvisioningError ? result.error.message : String(result.error)
      yield* withErr(
        sql`
          UPDATE provisioning_jobs
          SET status = 'failed', last_error = ${errorMsg}
          WHERE id = ${jobId}
        `.pipe(Effect.asVoid),
        "Failed to mark job as failed",
      )
    }
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
          const id = yield* insertJob(sql, (row as any).id as string, grantId, operation)
          jobIds.push(id)
        }
        return jobIds
      })

    return {
      onGrantActivated: (grantId) => enqueueForAllSystems(grantId, "provision"),

      onGrantRevoked: (grantId) => enqueueForAllSystems(grantId, "deprovision"),

      processNextPending: () =>
        Effect.gen(function* () {
          const jobs = yield* withErr(
            sql`
              SELECT * FROM provisioning_jobs
              WHERE status = 'pending'
              ORDER BY created_at ASC
              LIMIT 1
            `,
            "Failed to fetch next pending job",
          )
          if (jobs.length === 0) return
          yield* processJobInternal(sql, jobs[0] as Record<string, any>)
        }),

      processJob: (jobId) =>
        Effect.gen(function* () {
          const jobs = yield* withErr(sql`SELECT * FROM provisioning_jobs WHERE id = ${jobId}`, "Failed to fetch job")
          if (jobs.length === 0) {
            return yield* Effect.fail(new ProvisioningError({ message: `Job ${jobId} not found` }))
          }
          yield* processJobInternal(sql, jobs[0] as Record<string, any>)
        }),
    }
  }),
)

// ---------------------------------------------------------------------------
// Dev layer — logs and does nothing
// ---------------------------------------------------------------------------

export const ProvisioningServiceDev = Layer.succeed(ProvisioningService, {
  onGrantActivated: (grantId) =>
    Effect.log(`[ProvisioningService/dev] onGrantActivated grantId=${grantId}`).pipe(Effect.as([] as string[])),

  onGrantRevoked: (grantId) =>
    Effect.log(`[ProvisioningService/dev] onGrantRevoked grantId=${grantId}`).pipe(Effect.as([] as string[])),

  processNextPending: () => Effect.log("[ProvisioningService/dev] processNextPending (no-op)").pipe(Effect.asVoid),

  processJob: (jobId) => Effect.log(`[ProvisioningService/dev] processJob jobId=${jobId} (no-op)`).pipe(Effect.asVoid),
})
