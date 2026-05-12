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

// =============================================================================
// Component-render tests
// =============================================================================

import { screen, waitFor } from "@testing-library/react"
import AdminPluginDetailPage from "./admin.plugins.$slug"
import { renderRoute } from "~/test/render-route"

const mkManifest = (slug: string) => ({
  slug,
  displayName: "Gitea Teams",
  version: "1.2.3",
  description: "Manages Gitea team memberships",
  capabilities: ["gitea.team.read", "gitea.team.member.add"],
  allowedDomains: ["gitea.internal"],
  vaultSecrets: ["secret/gitea/token"],
  configSchema: {},
  permissionStrategy: {
    byRoleSlug: {
      editor: [{ op: "addToGroup", group: "editors" }],
    },
  },
  imperative: false,
  timeoutMs: 10_000,
  ownedLldapGroups: [],
})

const renderPage = (
  data: {
    manifest?: ReturnType<typeof mkManifest>
    installs?: unknown[]
    recentEvents?: unknown[]
  } = {},
) =>
  renderRoute({
    parentLoaderId: "routes/dashboard",
    parentLoader: () => ({ user: "admin", isAdmin: true }),
    route: {
      path: "/admin/plugins/gitea-teams",
      Component: AdminPluginDetailPage as never,
      loader: () => ({
        manifest: data.manifest ?? mkManifest("gitea-teams"),
        installs: data.installs ?? [],
        recentEvents: data.recentEvents ?? [],
      }),
    },
  })

describe("AdminPluginDetailPage component", () => {
  it("renders manifest header + empty states", async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText("Gitea Teams")).toBeInTheDocument()
    })
    expect(screen.getByText("v1.2.3")).toBeInTheDocument()
    expect(screen.getByText("gitea.team.read")).toBeInTheDocument()
    expect(screen.getByText("Not installed on any application yet.")).toBeInTheDocument()
    expect(screen.getByText("No recent plugin invocations.")).toBeInTheDocument()
  })

  it("renders install rows when installs are present", async () => {
    renderPage({
      installs: [
        {
          system: {
            id: "cs-1",
            applicationId: "app-1",
            connectorType: "plugin",
            config: {},
            status: "active" as const,
            pluginSlug: "gitea-teams",
            pluginVersion: "1.0.0",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
          applicationSlug: "jellyfin",
          applicationName: "Jellyfin",
        },
      ],
    })

    await waitFor(() => {
      expect(screen.getByText("Jellyfin")).toBeInTheDocument()
    })
    expect(screen.getByText("jellyfin")).toBeInTheDocument()
    // The status badge text.
    expect(screen.getByText("active")).toBeInTheDocument()
  })
})
