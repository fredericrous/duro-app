// Set operator URL before module imports read config
process.env.OPERATOR_API_URL = "http://operator.test:9090"

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest"
import { Context, Effect, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"

// PGlite migration + truncation takes ~2-3s per test under parallel load.
// Default 5s timeout is too tight when many test files run concurrently.
vi.setConfig({ testTimeout: 30000 })
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { FetchHttpClient } from "@effect/platform"
import { AppSyncService, AppSyncServiceLive } from "./AppSyncService.server"
import { OperatorClient, OperatorClientLive, type ClusterApp } from "~/lib/services/OperatorClient.server"
import { ApplicationRepo, ApplicationRepoLive } from "./ApplicationRepo.server"
import { RbacRepo, RbacRepoLive, RbacRepoError } from "./RbacRepo.server"
import { ConnectedSystemRepo, ConnectedSystemRepoLive } from "./ConnectedSystemRepo.server"
import { ConnectorMappingRepo, ConnectorMappingRepoLive } from "./ConnectorMappingRepo.server"
import { makeTestDbLayer } from "~/lib/db/client.server"
import { STARTER_ENTITLEMENTS, STARTER_ROLES } from "./defaultRbac"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const clusterApps: ClusterApp[] = [
  {
    id: "jellyfin",
    name: "Jellyfin",
    url: "https://jellyfin.local",
    category: "media",
    groups: ["media"],
    priority: 10,
  },
  { id: "gitea", name: "Gitea", url: "https://gitea.local", category: "dev", groups: ["dev"], priority: 20 },
  {
    id: "grafana",
    name: "Grafana",
    url: "https://grafana.local",
    category: "monitoring",
    groups: ["admin"],
    priority: 30,
  },
]

// ---------------------------------------------------------------------------
// Layer composition — real DB via PGlite, only OperatorClient is stubbed.
// ---------------------------------------------------------------------------

type OperatorClientService = Context.Tag.Service<typeof OperatorClient>

const stubOperatorClient = (apps: ClusterApp[]): OperatorClientService => ({
  listApps: () => Effect.succeed(apps),
})

/**
 * Build a full layer for a single test. PGlite is fresh per test (truncated
 * in makeTestDbLayer), so tests don't share state.
 */
function layersFor(operatorApps: ClusterApp[]) {
  return Layer.mergeAll(
    Layer.succeed(OperatorClient, stubOperatorClient(operatorApps)),
    AppSyncServiceLive,
    ApplicationRepoLive,
    RbacRepoLive,
    ConnectedSystemRepoLive,
    ConnectorMappingRepoLive,
  ).pipe(Layer.provideMerge(makeTestDbLayer()))
}

/**
 * Seed existing apps (mimicking what a previous sync / manual insert would
 * have produced) before the sync runs. Takes the same Application-shape
 * objects the old mock used. Called inside the Effect so SQL is available.
 */
const seedExistingApps = (
  apps: Array<{ slug: string; displayName: string; enabled?: boolean; accessMode?: string; ownerId?: string }>,
) =>
  Effect.gen(function* () {
    const repo = yield* ApplicationRepo
    for (const a of apps) {
      const created = yield* repo.create({
        slug: a.slug,
        displayName: a.displayName,
        accessMode: a.accessMode ?? "invite_only",
        ownerId: a.ownerId,
      })
      if (a.enabled === false) {
        yield* repo.update(created.id, { enabled: false })
      }
    }
  })

// ---------------------------------------------------------------------------
// Tests: sync logic
// ---------------------------------------------------------------------------

describe("AppSyncService", () => {
  it("creates apps that don't exist in DB", async () => {
    const result = await Effect.gen(function* () {
      const sync = yield* AppSyncService
      return yield* sync.syncFromCluster()
    }).pipe(Effect.provide(layersFor(clusterApps)), Effect.runPromise)

    expect(result.created).toBe(3)
    expect(result.updated).toBe(0)
    expect(result.disabled).toBe(0)
    expect(result.total).toBe(3)
  })

  it("does not duplicate existing apps", async () => {
    const result = await Effect.gen(function* () {
      yield* seedExistingApps([{ slug: "jellyfin", displayName: "Jellyfin" }])
      const sync = yield* AppSyncService
      return yield* sync.syncFromCluster()
    }).pipe(Effect.provide(layersFor(clusterApps)), Effect.runPromise)

    expect(result.created).toBe(2) // gitea + grafana
    expect(result.updated).toBe(0) // jellyfin name matches
  })

  it("updates displayName when it differs", async () => {
    const result = await Effect.gen(function* () {
      yield* seedExistingApps([{ slug: "jellyfin", displayName: "Old Name" }])
      const sync = yield* AppSyncService
      return yield* sync.syncFromCluster()
    }).pipe(Effect.provide(layersFor(clusterApps)), Effect.runPromise)

    expect(result.updated).toBe(1)
    expect(result.created).toBe(2)
  })

  it("disables apps no longer in the cluster", async () => {
    const result = await Effect.gen(function* () {
      yield* seedExistingApps([
        { slug: "jellyfin", displayName: "Jellyfin" },
        { slug: "removed-app", displayName: "Removed App" },
      ])
      const sync = yield* AppSyncService
      return yield* sync.syncFromCluster()
    }).pipe(Effect.provide(layersFor(clusterApps)), Effect.runPromise)

    expect(result.disabled).toBe(1)
    expect(result.created).toBe(2) // gitea + grafana
  })

  it("does not disable already-disabled apps", async () => {
    const result = await Effect.gen(function* () {
      yield* seedExistingApps([
        { slug: "jellyfin", displayName: "Jellyfin" },
        { slug: "removed-app", displayName: "Removed App", enabled: false },
      ])
      const sync = yield* AppSyncService
      return yield* sync.syncFromCluster()
    }).pipe(Effect.provide(layersFor(clusterApps)), Effect.runPromise)

    expect(result.disabled).toBe(0)
  })

  it("handles empty cluster (disables all)", async () => {
    const result = await Effect.gen(function* () {
      yield* seedExistingApps([
        { slug: "jellyfin", displayName: "Jellyfin" },
        { slug: "gitea", displayName: "Gitea" },
      ])
      const sync = yield* AppSyncService
      return yield* sync.syncFromCluster()
    }).pipe(Effect.provide(layersFor([])), Effect.runPromise)

    expect(result.created).toBe(0)
    expect(result.disabled).toBe(2)
    expect(result.total).toBe(0)
  })

  it("handles empty DB (creates all)", async () => {
    const result = await Effect.gen(function* () {
      const sync = yield* AppSyncService
      return yield* sync.syncFromCluster()
    }).pipe(Effect.provide(layersFor(clusterApps)), Effect.runPromise)

    expect(result.created).toBe(3)
    expect(result.disabled).toBe(0)
  })

  it("preserves governance fields on sync", async () => {
    const jf = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      // Seed an admin principal so the owner_id FK resolves.
      yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
                 VALUES ('admin-user', 'user', 'admin-user', 'Admin', 'admin@localhost')`
      yield* seedExistingApps([
        { slug: "jellyfin", displayName: "Jellyfin", accessMode: "open", ownerId: "admin-user" },
      ])
      const sync = yield* AppSyncService
      yield* sync.syncFromCluster()
      const repo = yield* ApplicationRepo
      return yield* repo.findBySlug("jellyfin")
    }).pipe(Effect.provide(layersFor(clusterApps)), Effect.runPromise)

    expect(jf).not.toBeNull()
    expect(jf!.accessMode).toBe("open")
    expect(jf!.ownerId).toBe("admin-user")
  })

  it("seeds starter roles and entitlements when an app is first synced", async () => {
    const { app, roles, ents } = await Effect.gen(function* () {
      const sync = yield* AppSyncService
      yield* sync.syncFromCluster()
      const appRepo = yield* ApplicationRepo
      const rbac = yield* RbacRepo
      const app = yield* appRepo.findBySlug("jellyfin")
      if (!app) throw new Error("app missing")
      const roles = yield* rbac.listRoles(app.id)
      const ents = yield* rbac.listEntitlements(app.id)
      return { app, roles, ents }
    }).pipe(Effect.provide(layersFor(clusterApps)), Effect.runPromise)

    expect(new Set(roles.map((r) => r.slug))).toEqual(new Set(STARTER_ROLES.map((r) => r.slug)))
    expect(new Set(ents.map((e) => e.slug))).toEqual(new Set(STARTER_ENTITLEMENTS.map((e) => e.slug)))
    expect(app.lastSyncedAt).not.toBeNull()
  })

  it("does not re-seed starter rbac when app already exists", async () => {
    const rolesAfter = await Effect.gen(function* () {
      yield* seedExistingApps([{ slug: "jellyfin", displayName: "Jellyfin" }])
      const sync = yield* AppSyncService
      yield* sync.syncFromCluster()
      const appRepo = yield* ApplicationRepo
      const rbac = yield* RbacRepo
      const jellyfin = yield* appRepo.findBySlug("jellyfin")
      return yield* rbac.listRoles(jellyfin!.id)
    }).pipe(Effect.provide(layersFor(clusterApps)), Effect.runPromise)

    // Pre-existing jellyfin was seeded without starter roles — sync doesn't
    // retrofit them, so it still has zero roles.
    expect(rolesAfter.length).toBe(0)
  })

  it("writes lastSyncedAt on every sync for both new and existing apps", async () => {
    const beforeTs = new Date().toISOString()

    const all = await Effect.gen(function* () {
      yield* seedExistingApps([{ slug: "jellyfin", displayName: "Jellyfin" }])
      const sync = yield* AppSyncService
      yield* sync.syncFromCluster()
      const appRepo = yield* ApplicationRepo
      return yield* appRepo.list()
    }).pipe(Effect.provide(layersFor(clusterApps)), Effect.runPromise)

    for (const a of all) {
      if (clusterApps.some((c) => c.id === a.slug)) {
        expect(a.lastSyncedAt).not.toBeNull()
        expect(a.lastSyncedAt! >= beforeTs).toBe(true)
      }
    }
  })

  it("backfills LDAP connected system and connector mappings for known slugs", async () => {
    const nextcloudCluster: ClusterApp[] = [
      { id: "nextcloud", name: "Nextcloud", url: "x", category: "cloud", groups: ["family"], priority: 50 },
    ]

    const result = await Effect.gen(function* () {
      const sync = yield* AppSyncService
      yield* sync.syncFromCluster()
      const appRepo = yield* ApplicationRepo
      const rbac = yield* RbacRepo
      const systems = yield* ConnectedSystemRepo
      const mappings = yield* ConnectorMappingRepo

      const app = yield* appRepo.findBySlug("nextcloud")
      const system = yield* systems.findByApplicationAndType(app!.id, "plugin")
      const roles = yield* rbac.listRoles(app!.id)

      const mappingsFor = new Map<string, string>()
      for (const r of roles) {
        const m = yield* mappings.findByConnectedSystemAndRole(system!.id, r.id)
        if (m) mappingsFor.set(r.slug, m.externalRoleIdentifier)
      }

      return { system, mappingsFor }
    }).pipe(Effect.provide(layersFor(nextcloudCluster)), Effect.runPromise)

    expect(result.system).not.toBeNull()
    expect(result.system!.connectorType).toBe("plugin")
    expect(result.mappingsFor.get("viewer")).toBe("nextcloud-user")
    expect(result.mappingsFor.get("editor")).toBe("nextcloud-user")
    expect(result.mappingsFor.get("admin")).toBe("nextcloud-admin")
  })

  it("does NOT create an LDAP connected system for apps outside the allow-list", async () => {
    const system = await Effect.gen(function* () {
      const sync = yield* AppSyncService
      yield* sync.syncFromCluster()
      const appRepo = yield* ApplicationRepo
      const systems = yield* ConnectedSystemRepo
      const app = yield* appRepo.findBySlug("jellyfin")
      return yield* systems.findByApplicationAndType(app!.id, "plugin")
    }).pipe(Effect.provide(layersFor(clusterApps)), Effect.runPromise)

    expect(system).toBeNull()
  })

  it("is idempotent — re-syncing a known-slug app does not duplicate connected systems or mappings", async () => {
    const nextcloudCluster: ClusterApp[] = [
      { id: "nextcloud", name: "Nextcloud", url: "x", category: "cloud", groups: ["family"], priority: 50 },
    ]

    const counts = await Effect.gen(function* () {
      const sync = yield* AppSyncService
      yield* sync.syncFromCluster() // first sync
      yield* sync.syncFromCluster() // second sync — must not duplicate
      const appRepo = yield* ApplicationRepo
      const systems = yield* ConnectedSystemRepo
      const mappings = yield* ConnectorMappingRepo
      const app = yield* appRepo.findBySlug("nextcloud")
      const systemList = yield* systems.listByApplication(app!.id)
      const system = systemList[0]
      const mappingList = yield* mappings.listByConnectedSystem(system!.id)
      return { systems: systemList.length, mappings: mappingList.length }
    }).pipe(Effect.provide(layersFor(nextcloudCluster)), Effect.runPromise)

    expect(counts.systems).toBe(1)
    // 3 starter roles × 1 mapping each
    expect(counts.mappings).toBe(STARTER_ROLES.length)
  })
})

// ---------------------------------------------------------------------------
// Tests: transactional rollback — uses a Layer override to inject a failing
// RbacRepo variant into the same real-DB layer.
// ---------------------------------------------------------------------------

type RbacRepoService = Context.Tag.Service<typeof RbacRepo>

const forcedError = new RbacRepoError({ message: "forced" })

/** A RbacRepo that fails on createEntitlement (first step of seedDefaultRbac). */
const FailingRbacRepo: RbacRepoService = {
  createEntitlement: () => Effect.fail(forcedError),
  createRole: () => Effect.fail(forcedError),
  attachEntitlement: () => Effect.void,
  detachEntitlement: () => Effect.void,
  listRoles: () => Effect.succeed([]),
  findRoleById: () => Effect.succeed(null),
  deleteRole: () => Effect.void,
  listEntitlements: () => Effect.succeed([]),
  findEntitlementById: () => Effect.succeed(null),
  deleteEntitlement: () => Effect.void,
  listRoleEntitlements: () => Effect.succeed([]),
  createResource: () => Effect.fail(forcedError),
  listResources: () => Effect.succeed([]),
  getResourceAncestors: () => Effect.succeed([]),
}

describe("AppSyncService — transactional seeding (real DB)", () => {
  it("rolls back app creation when starter rbac seed fails", { timeout: 30000 }, async () => {
    const layers = Layer.mergeAll(
      Layer.succeed(OperatorClient, stubOperatorClient([clusterApps[0]])),
      AppSyncServiceLive,
      ApplicationRepoLive,
      Layer.succeed(RbacRepo, FailingRbacRepo),
      ConnectedSystemRepoLive,
      ConnectorMappingRepoLive,
    ).pipe(Layer.provideMerge(makeTestDbLayer()))

    const { syncResult, apps } = await Effect.gen(function* () {
      const sync = yield* AppSyncService
      const syncResult = yield* Effect.either(sync.syncFromCluster())
      const repo = yield* ApplicationRepo
      const apps = yield* repo.list()
      return { syncResult, apps }
    }).pipe(Effect.provide(layers), Effect.runPromise)

    expect(syncResult._tag).toBe("Left")
    expect(apps.find((a) => a.slug === "jellyfin")).toBeUndefined()
  })

  it("commits app + starter rbac + LDAP backfill together when seed succeeds", { timeout: 30000 }, async () => {
    const nextcloudCluster: ClusterApp[] = [
      { id: "nextcloud", name: "Nextcloud", url: "x", category: "cloud", groups: ["family"], priority: 50 },
    ]

    const { app, roles, ents, system } = await Effect.gen(function* () {
      const sync = yield* AppSyncService
      yield* sync.syncFromCluster()
      const appRepo = yield* ApplicationRepo
      const rbac = yield* RbacRepo
      const systems = yield* ConnectedSystemRepo
      const app = yield* appRepo.findBySlug("nextcloud")
      if (!app) throw new Error("app missing")
      const roles = yield* rbac.listRoles(app.id)
      const ents = yield* rbac.listEntitlements(app.id)
      const system = yield* systems.findByApplicationAndType(app.id, "plugin")
      return { app, roles, ents, system }
    }).pipe(Effect.provide(layersFor(nextcloudCluster)), Effect.runPromise)

    expect(app.lastSyncedAt).not.toBeNull()
    expect(new Set(roles.map((r) => r.slug))).toEqual(new Set(["viewer", "editor", "admin"]))
    expect(new Set(ents.map((e) => e.slug))).toEqual(new Set(["read", "write", "manage"]))
    expect(system).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Tests: OperatorClientLive via MSW (HTTP integration — unchanged)
// ---------------------------------------------------------------------------

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe("OperatorClientLive with MSW", () => {
  const layer = Layer.mergeAll(OperatorClientLive).pipe(Layer.provide(FetchHttpClient.layer))

  it("fetches and decodes apps from the operator API", async () => {
    server.use(
      http.get("*/api/v1/apps", () => {
        return HttpResponse.json(clusterApps)
      }),
    )

    const result = await Effect.gen(function* () {
      const client = yield* OperatorClient
      return yield* client.listApps()
    }).pipe(Effect.provide(layer), Effect.runPromise)

    expect(result).toHaveLength(3)
    expect(result[0].id).toBe("jellyfin")
    expect(result[0].name).toBe("Jellyfin")
  })

  it("returns error when operator is unreachable", async () => {
    server.use(
      http.get("*/api/v1/apps", () => {
        return HttpResponse.json({ error: "internal" }, { status: 500 })
      }),
    )

    const result = await Effect.gen(function* () {
      const client = yield* OperatorClient
      return yield* client.listApps()
    }).pipe(Effect.provide(layer), Effect.either, Effect.runPromise)

    expect(result._tag).toBe("Left")
  })
})
