// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterAll } from "vitest"
import { Effect, Layer, ManagedRuntime } from "effect"
import { FetchHttpClient } from "@effect/platform"
import * as SqlClient from "@effect/sql/SqlClient"
import { makeTestDbLayer } from "~/lib/db/client.server"

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

import { expireGrants } from "./grant-activation.server"
import { ProvisioningServiceLive } from "~/lib/governance/ProvisioningService.server"
import { GrantRepoLive } from "~/lib/governance/GrantRepo.server"
import { AuditServiceLive } from "~/lib/governance/AuditService.server"
import { ConnectedSystemRepoLive } from "~/lib/governance/ConnectedSystemRepo.server"
import { ConnectorMappingRepoLive } from "~/lib/governance/ConnectorMappingRepo.server"
import { PluginHost } from "~/lib/plugins/PluginHost.server"

const HostStub = Layer.succeed(PluginHost, {
  runProvision: () => Effect.void,
  runDeprovision: () => Effect.void,
} as any)

let rt: ManagedRuntime.ManagedRuntime<unknown, unknown> | null = null
function runtime() {
  if (!rt) {
    const layer = Layer.mergeAll(
      GrantRepoLive,
      AuditServiceLive,
      ProvisioningServiceLive,
      ConnectedSystemRepoLive,
      ConnectorMappingRepoLive,
      HostStub,
    ).pipe(Layer.provideMerge(makeTestDbLayer()), Layer.provide(FetchHttpClient.layer))
    rt = ManagedRuntime.make(layer) as ManagedRuntime.ManagedRuntime<unknown, unknown>
  }
  return rt
}

afterAll(async () => {
  if (rt) {
    await rt.dispose()
    rt = null
  }
})

beforeEach(async () => {
  if (rt) {
    await rt.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`TRUNCATE provisioning_jobs, connected_systems, grants, roles, applications, principals RESTART IDENTITY CASCADE`
      }) as Effect.Effect<void, never, never>,
    )
  }
})

const seedExpiredGrant = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
             VALUES ('p-alice', 'user', 'alice', 'Alice', 'a@x'), ('p-admin', 'user', 'admin', 'Admin', 'ad@x')`
  yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, owner_id)
             VALUES ('app-1', 'app-1', 'App 1', 'request', 'p-admin')`
  yield* sql`INSERT INTO roles (id, application_id, slug, display_name) VALUES ('role-1', 'app-1', 'viewer', 'Viewer')`
  // An active grant already past its expiry.
  yield* sql`INSERT INTO grants (id, principal_id, role_id, granted_by, expires_at)
             VALUES ('g-exp', 'p-alice', 'role-1', 'p-admin', NOW() - INTERVAL '1 hour')`
  // A future grant that must NOT be touched.
  yield* sql`INSERT INTO grants (id, principal_id, role_id, granted_by, expires_at)
             VALUES ('g-live', 'p-alice', 'role-1', 'p-admin', NOW() + INTERVAL '1 hour')`
  yield* sql`INSERT INTO connected_systems (id, application_id, connector_type, config, status, plugin_slug, plugin_version)
             VALUES ('cs-1', 'app-1', 'plugin', '{}'::jsonb, 'active', 'fake', '1.0.0')`
}) as Effect.Effect<void, never, never>

describe("expireGrants", () => {
  it("revokes an expired grant and enqueues a deprovision job; leaves live grants alone", async () => {
    await runtime().runPromise(seedExpiredGrant)

    const count = await runtime().runPromise(expireGrants as Effect.Effect<number, unknown, never>)
    expect(count).toBe(1)

    const state = await runtime().runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const exp = yield* sql<{ revokedAt: string | null }>`SELECT revoked_at FROM grants WHERE id = 'g-exp'`
        const live = yield* sql<{ revokedAt: string | null }>`SELECT revoked_at FROM grants WHERE id = 'g-live'`
        const jobs = yield* sql<{
          n: number
        }>`SELECT count(*)::int AS n FROM provisioning_jobs WHERE grant_id = 'g-exp' AND operation = 'deprovision'`
        return { expRevoked: exp[0]?.revokedAt, liveRevoked: live[0]?.revokedAt, deprovJobs: jobs[0]?.n }
      }) as Effect.Effect<{ expRevoked: string | null; liveRevoked: string | null; deprovJobs: number }, never, never>,
    )

    expect(state.expRevoked).not.toBeNull() // expired grant was revoked
    expect(state.liveRevoked).toBeNull() // future grant untouched
    expect(state.deprovJobs).toBeGreaterThanOrEqual(1) // deprovision enqueued
  })

  it("is a no-op when nothing has expired", async () => {
    await runtime().runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO principals (id, principal_type, display_name) VALUES ('p-a', 'user', 'A')`
        yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, owner_id) VALUES ('ap', 'ap', 'Ap', 'request', 'p-a')`
        yield* sql`INSERT INTO roles (id, application_id, slug, display_name) VALUES ('r', 'ap', 'v', 'V')`
        yield* sql`INSERT INTO grants (id, principal_id, role_id, granted_by, expires_at) VALUES ('g', 'p-a', 'r', 'p-a', NOW() + INTERVAL '1 day')`
      }) as Effect.Effect<void, never, never>,
    )
    const count = await runtime().runPromise(expireGrants as Effect.Effect<number, unknown, never>)
    expect(count).toBe(0)
  })
})
