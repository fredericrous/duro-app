import { describe, expect, it, vi, beforeEach } from "vitest"
import { Effect } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"

vi.mock("~/lib/runtime.server", async () => {
  const mod = await import("~/test/test-runtime")
  return { runEffect: mod.testRunEffect }
})

import { loader } from "./admin.plugins.$slug"
import { seedTestDb, truncateAll } from "~/test/test-runtime"
import { callLoader, expectData } from "~/test/route-utils"

beforeEach(async () => {
  vi.clearAllMocks()
  await truncateAll()
})

const seedApp = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
             VALUES ('p-admin', 'user', 'admin', 'Admin', 'a@x')`
  yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, owner_id)
             VALUES ('app-1', 'app-1', 'App 1', 'request', 'p-admin')`
})

describe("/admin/plugins/:slug loader", () => {
  it("returns manifest + (empty) installs when the plugin has no connected systems", async () => {
    await seedTestDb(seedApp)

    // gitea-teams is one of the built-in plugins registered by PluginRegistry.
    const result = await callLoader(loader, { params: { slug: "gitea-teams" } })
    const data = expectData<{ manifest: { slug: string }; installs: unknown[] }>(result)
    expect(data.manifest.slug).toBe("gitea-teams")
    expect(data.installs).toEqual([])
  })

  it("returns the installs array populated when an app has the plugin configured", async () => {
    await seedTestDb(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
                   VALUES ('p-admin', 'user', 'admin', 'Admin', 'a@x')`
        yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, owner_id)
                   VALUES ('app-1', 'app-1', 'App 1', 'request', 'p-admin')`
        yield* sql`INSERT INTO connected_systems (id, application_id, connector_type, config, status, plugin_slug, plugin_version)
                   VALUES ('cs-1', 'app-1', 'plugin', '{}'::jsonb, 'active', 'gitea-teams', '1.0.0')`
      }) as Effect.Effect<void, never, never>,
    )

    const result = await callLoader(loader, { params: { slug: "gitea-teams" } })
    const data = expectData<{ installs: Array<{ applicationSlug: string }> }>(result)
    expect(data.installs).toHaveLength(1)
    expect(data.installs[0].applicationSlug).toBe("app-1")
  })
})
