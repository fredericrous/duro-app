import { describe, expect, it, vi, beforeEach } from "vitest"
import { Effect, Layer, ManagedRuntime } from "effect"
import { FetchHttpClient } from "@effect/platform"
import * as SqlClient from "@effect/sql/SqlClient"
import { makeTestDbLayer } from "~/lib/db/client.server"

import { ProvisioningService, ProvisioningServiceLive } from "./ProvisioningService.server"
import { PluginHost } from "~/lib/plugins/PluginHost.server"

// ---------------------------------------------------------------------------
// PluginHost stub — ProvisioningService dispatches into PluginHost for
// connector_type=plugin. We swap a vi.fn-backed Layer.succeed so we can
// assert which method got called with what args, without standing up the
// full PluginHost stack (covered in PluginHost.server.test.ts).
// ---------------------------------------------------------------------------

interface HostCall {
  method: "runProvision" | "runDeprovision"
  pluginSlug: string
  grantId: string
  connectedSystemId: string
}

function makeHostStub(opts: { fail?: boolean } = {}) {
  const calls: HostCall[] = []
  const failingBehaviour = opts.fail
    ? () => Effect.fail({ _tag: "PluginHostError", message: "boom" } as never)
    : () => Effect.void
  const layer = Layer.succeed(PluginHost, {
    runProvision: (pluginSlug: string, grantId: string, connectedSystemId: string) => {
      calls.push({ method: "runProvision", pluginSlug, grantId, connectedSystemId })
      return failingBehaviour()
    },
    runDeprovision: (pluginSlug: string, grantId: string, connectedSystemId: string) => {
      calls.push({ method: "runDeprovision", pluginSlug, grantId, connectedSystemId })
      return failingBehaviour()
    },
  } as never)
  return { layer, calls }
}

// ---------------------------------------------------------------------------
// Runtime factory — ProvisioningServiceLive + real DB + stub PluginHost
// ---------------------------------------------------------------------------

function makeRuntime(hostLayer: Layer.Layer<PluginHost, never, never>) {
  const layer = ProvisioningServiceLive.pipe(
    Layer.provideMerge(makeTestDbLayer()),
    Layer.provideMerge(hostLayer),
    Layer.provide(FetchHttpClient.layer),
  )
  return ManagedRuntime.make(layer)
}

// ---------------------------------------------------------------------------
// Seed: app + role + grant + connected_system. Variants control
// connector_type + config.
// ---------------------------------------------------------------------------

interface SeedOpts {
  /** "plugin" | "http" | "ldap" etc — drives processJobInternal dispatch. */
  connectorType?: "plugin" | "http" | "ldap" | "scim" | "webhook"
  pluginSlug?: string
  /** Connected system config JSON. Default "{}". */
  config?: string
  /** Status of the connected system. Default "active". */
  systemStatus?: "active" | "disabled" | "error"
  /** Insert a second connected_system on the same app — exercises enqueue-for-all. */
  twoSystems?: boolean
}

const seed = (opts: SeedOpts = {}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
               VALUES ('p-alice', 'user', 'alice-sub', 'Alice', 'a@x'),
                      ('p-admin', 'user', 'admin', 'Admin', 'ad@x')`
    yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, owner_id)
               VALUES ('app-1', 'app-1', 'App 1', 'request', 'p-admin')`
    yield* sql`INSERT INTO roles (id, application_id, slug, display_name)
               VALUES ('role-editor', 'app-1', 'editor', 'Editor')`
    yield* sql`INSERT INTO grants (id, principal_id, role_id, granted_by, created_at)
               VALUES ('g-1', 'p-alice', 'role-editor', 'p-admin', NOW())`

    const ct = opts.connectorType ?? "plugin"
    const cfg = opts.config ?? "{}"
    const status = opts.systemStatus ?? "active"
    if (ct === "plugin") {
      yield* sql`INSERT INTO connected_systems
                 (id, application_id, connector_type, config, status, plugin_slug, plugin_version)
                 VALUES ('cs-1', 'app-1', 'plugin', ${cfg}::jsonb, ${status},
                         ${opts.pluginSlug ?? "fake-plugin"}, '1.0.0')`
    } else {
      yield* sql`INSERT INTO connected_systems
                 (id, application_id, connector_type, config, status)
                 VALUES ('cs-1', 'app-1', ${ct}, ${cfg}::jsonb, ${status})`
    }

    if (opts.twoSystems) {
      yield* sql`INSERT INTO connected_systems
                 (id, application_id, connector_type, config, status, plugin_slug, plugin_version)
                 VALUES ('cs-2', 'app-1', 'plugin', '{}'::jsonb, 'active', 'fake-plugin', '1.0.0')`
    }
  }) as Effect.Effect<void, never, never>

// ---------------------------------------------------------------------------
// onGrantActivated / onGrantRevoked — enqueue jobs
// ---------------------------------------------------------------------------

describe("ProvisioningService — onGrantActivated / onGrantRevoked", () => {
  it("enqueues one provisioning job per active connected_system for the grant's app", async () => {
    const { layer } = makeHostStub()
    const rt = makeRuntime(layer)
    await rt.runPromise(seed({ twoSystems: true }))

    const jobIds = await rt.runPromise(
      Effect.gen(function* () {
        const svc = yield* ProvisioningService
        return yield* svc.onGrantActivated("g-1")
      }),
    )

    expect(jobIds).toHaveLength(2)

    // Verify the rows landed with `operation='provision'` and `status='pending'`.
    const rows = await rt.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ operation: string; status: string; grantId: string }>`
          SELECT operation, status, grant_id FROM provisioning_jobs ORDER BY created_at ASC`
      }) as Effect.Effect<Array<{ operation: string; status: string; grantId: string }>, never, never>,
    )
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.operation === "provision")).toBe(true)
    expect(rows.every((r) => r.status === "pending")).toBe(true)
    expect(rows.every((r) => r.grantId === "g-1")).toBe(true)
  })

  it("onGrantRevoked enqueues with operation='deprovision'", async () => {
    const { layer } = makeHostStub()
    const rt = makeRuntime(layer)
    await rt.runPromise(seed())

    await rt.runPromise(
      Effect.gen(function* () {
        const svc = yield* ProvisioningService
        return yield* svc.onGrantRevoked("g-1")
      }),
    )

    const rows = await rt.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ operation: string }>`SELECT operation FROM provisioning_jobs`
      }) as Effect.Effect<Array<{ operation: string }>, never, never>,
    )
    expect(rows[0]?.operation).toBe("deprovision")
  })

  it("skips disabled connected systems", async () => {
    const { layer } = makeHostStub()
    const rt = makeRuntime(layer)
    await rt.runPromise(seed({ systemStatus: "disabled" }))

    const jobIds = await rt.runPromise(
      Effect.gen(function* () {
        const svc = yield* ProvisioningService
        return yield* svc.onGrantActivated("g-1")
      }),
    )
    expect(jobIds).toEqual([]) // findConnectedSystems filters status='active'
  })
})

// ---------------------------------------------------------------------------
// processJob — dispatch on connector_type
// ---------------------------------------------------------------------------

describe("ProvisioningService — processJob dispatch", () => {
  it("dispatches connector_type='plugin' jobs into PluginHost.runProvision", async () => {
    const { layer, calls } = makeHostStub()
    const rt = makeRuntime(layer)
    await rt.runPromise(seed())

    // Manually enqueue a job (skip onGrantActivated for isolation).
    const jobId = await rt.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ id: string }>`
          INSERT INTO provisioning_jobs (connected_system_id, grant_id, operation)
          VALUES ('cs-1', 'g-1', 'provision') RETURNING id`
        return rows[0].id
      }) as Effect.Effect<string, never, never>,
    )

    await rt.runPromise(
      Effect.gen(function* () {
        const svc = yield* ProvisioningService
        return yield* svc.processJob(jobId)
      }),
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      method: "runProvision",
      pluginSlug: "fake-plugin",
      grantId: "g-1",
      connectedSystemId: "cs-1",
    })

    // Status should be 'completed' on success.
    const status = await rt.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ status: string }>`
          SELECT status FROM provisioning_jobs WHERE id = ${jobId}`
        return rows[0].status
      }) as Effect.Effect<string, never, never>,
    )
    expect(status).toBe("completed")
  })

  it("marks the job 'failed' + records last_error when PluginHost fails", async () => {
    const { layer } = makeHostStub({ fail: true })
    const rt = makeRuntime(layer)
    await rt.runPromise(seed())

    const jobId = await rt.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ id: string }>`
          INSERT INTO provisioning_jobs (connected_system_id, grant_id, operation)
          VALUES ('cs-1', 'g-1', 'provision') RETURNING id`
        return rows[0].id
      }) as Effect.Effect<string, never, never>,
    )

    // processJob surfaces the error AFTER onExit has marked the row 'failed'.
    // runPromiseExit lets us assert both: dispatch failed AND the row was
    // recorded as failed via the cleanup branch.
    const exit = await rt.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* ProvisioningService
        return yield* svc.processJob(jobId)
      }),
    )
    expect(exit._tag).toBe("Failure")

    const row = await rt.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ status: string; lastError: string | null }>`
          SELECT status, last_error FROM provisioning_jobs WHERE id = ${jobId}`
        return rows[0]
      }) as Effect.Effect<{ status: string; lastError: string | null }, never, never>,
    )
    expect(row.status).toBe("failed")
    expect(row.lastError).toBeTruthy()
  })

  it("dispatches connector_type='http' to executeHttpConnector (fails when URL not configured)", async () => {
    const { layer } = makeHostStub()
    const rt = makeRuntime(layer)
    // HTTP connector with no provisionUrl in config → executeHttpConnector throws.
    await rt.runPromise(seed({ connectorType: "http", config: "{}" }))

    const jobId = await rt.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ id: string }>`
          INSERT INTO provisioning_jobs (connected_system_id, grant_id, operation)
          VALUES ('cs-1', 'g-1', 'provision') RETURNING id`
        return rows[0].id
      }) as Effect.Effect<string, never, never>,
    )

    const exit = await rt.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* ProvisioningService
        return yield* svc.processJob(jobId)
      }),
    )
    expect(exit._tag).toBe("Failure")

    // Missing URL → onExit marks 'failed'.
    const row = await rt.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ status: string; lastError: string | null }>`
          SELECT status, last_error FROM provisioning_jobs WHERE id = ${jobId}`
        return rows[0]
      }) as Effect.Effect<{ status: string; lastError: string | null }, never, never>,
    )
    expect(row.status).toBe("failed")
    expect(row.lastError).toMatch(/No provision URL configured|HTTP connector failed/i)
  })

  it("fails with 'Connector type not implemented' for unknown connector_type", async () => {
    const { layer } = makeHostStub()
    const rt = makeRuntime(layer)
    // Use 'scim' (passes the CHECK constraint, but ProvisioningService doesn't dispatch it).
    await rt.runPromise(seed({ connectorType: "scim" }))

    const jobId = await rt.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ id: string }>`
          INSERT INTO provisioning_jobs (connected_system_id, grant_id, operation)
          VALUES ('cs-1', 'g-1', 'provision') RETURNING id`
        return rows[0].id
      }) as Effect.Effect<string, never, never>,
    )

    const exit = await rt.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* ProvisioningService
        return yield* svc.processJob(jobId)
      }),
    )
    expect(exit._tag).toBe("Failure")

    const row = await rt.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ status: string; lastError: string | null }>`
          SELECT status, last_error FROM provisioning_jobs WHERE id = ${jobId}`
        return rows[0]
      }) as Effect.Effect<{ status: string; lastError: string | null }, never, never>,
    )
    expect(row.status).toBe("failed")
    expect(row.lastError).toMatch(/not implemented/i)
  })
})

// ---------------------------------------------------------------------------
// Idempotency + processNextPending
// ---------------------------------------------------------------------------

describe("ProvisioningService — idempotency + processNextPending", () => {
  it("is a no-op on already-completed jobs (idempotent re-run)", async () => {
    const { layer, calls } = makeHostStub()
    const rt = makeRuntime(layer)
    await rt.runPromise(seed())

    const jobId = await rt.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ id: string }>`
          INSERT INTO provisioning_jobs (connected_system_id, grant_id, operation, status, completed_at)
          VALUES ('cs-1', 'g-1', 'provision', 'completed', NOW()) RETURNING id`
        return rows[0].id
      }) as Effect.Effect<string, never, never>,
    )

    await rt.runPromise(
      Effect.gen(function* () {
        const svc = yield* ProvisioningService
        return yield* svc.processJob(jobId)
      }),
    )

    expect(calls).toHaveLength(0) // PluginHost never invoked
  })

  it("processNextPending picks up the oldest pending job", async () => {
    const { layer, calls } = makeHostStub()
    const rt = makeRuntime(layer)
    await rt.runPromise(seed())
    await rt.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO provisioning_jobs (id, connected_system_id, grant_id, operation, status, created_at)
                   VALUES ('j-old', 'cs-1', 'g-1', 'provision', 'pending', NOW() - INTERVAL '1 hour'),
                          ('j-new', 'cs-1', 'g-1', 'provision', 'pending', NOW())`
      }) as Effect.Effect<void, never, never>,
    )

    await rt.runPromise(
      Effect.gen(function* () {
        const svc = yield* ProvisioningService
        return yield* svc.processNextPending()
      }),
    )

    // Only the older job got dispatched.
    expect(calls).toHaveLength(1)
    const status = await rt.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ id: string; status: string }>`
          SELECT id, status FROM provisioning_jobs ORDER BY created_at ASC`
        return rows
      }) as Effect.Effect<Array<{ id: string; status: string }>, never, never>,
    )
    expect(status[0]).toEqual({ id: "j-old", status: "completed" })
    expect(status[1]).toEqual({ id: "j-new", status: "pending" })
  })

  it("processNextPending is a no-op when there are no pending rows", async () => {
    const { layer, calls } = makeHostStub()
    const rt = makeRuntime(layer)
    await rt.runPromise(seed())
    // Pre-existing completed row only.
    await rt.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO provisioning_jobs (connected_system_id, grant_id, operation, status, completed_at)
                   VALUES ('cs-1', 'g-1', 'provision', 'completed', NOW())`
      }) as Effect.Effect<void, never, never>,
    )

    await rt.runPromise(
      Effect.gen(function* () {
        const svc = yield* ProvisioningService
        return yield* svc.processNextPending()
      }),
    )
    expect(calls).toHaveLength(0)
  })
})
