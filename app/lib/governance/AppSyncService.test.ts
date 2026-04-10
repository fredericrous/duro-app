// Set operator URL before module imports read config
process.env.OPERATOR_API_URL = "http://operator.test:9090"

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest"
import { Effect, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { FetchHttpClient } from "@effect/platform"
import { AppSyncService, AppSyncServiceLive } from "./AppSyncService.server"
import { OperatorClient, OperatorClientLive, type ClusterApp } from "~/lib/services/OperatorClient.server"
import { ApplicationRepo, ApplicationRepoLive } from "./ApplicationRepo.server"
import { RbacRepo, RbacRepoLive } from "./RbacRepo.server"
import { makeTestDbLayer } from "~/lib/db/client.server"
import { STARTER_ENTITLEMENTS, STARTER_ROLES } from "./defaultRbac"
import type { Application, Entitlement, Role } from "./types"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const clusterApps: ClusterApp[] = [
  { id: "jellyfin", name: "Jellyfin", url: "https://jellyfin.local", category: "media", groups: ["media"], priority: 10 },
  { id: "gitea", name: "Gitea", url: "https://gitea.local", category: "dev", groups: ["dev"], priority: 20 },
  { id: "grafana", name: "Grafana", url: "https://grafana.local", category: "monitoring", groups: ["admin"], priority: 30 },
]

function makeApp(slug: string, displayName: string, enabled = true): Application {
  return {
    id: `app-${slug}`,
    slug,
    displayName,
    description: null,
    accessMode: "invite_only",
    ownerId: null,
    enabled,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastSyncedAt: null,
  }
}

// ---------------------------------------------------------------------------
// Mock ApplicationRepo (in-memory)
// ---------------------------------------------------------------------------

function mockApplicationRepo(initial: Application[] = []) {
  const apps = new Map(initial.map((a) => [a.id, { ...a }]))
  let nextId = apps.size + 1

  return Layer.succeed(ApplicationRepo, {
    create: (input: any) =>
      Effect.sync(() => {
        const id = `app-${nextId++}`
        const app: Application = {
          id,
          slug: input.slug,
          displayName: input.displayName,
          description: input.description ?? null,
          accessMode: input.accessMode ?? "invite_only",
          ownerId: input.ownerId ?? null,
          enabled: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastSyncedAt: input.lastSyncedAt ?? null,
        }
        apps.set(id, app)
        return app
      }),
    findById: (id: string) => Effect.sync(() => apps.get(id) ?? null),
    findBySlug: (slug: string) => Effect.sync(() => [...apps.values()].find((a) => a.slug === slug) ?? null),
    list: () => Effect.sync(() => [...apps.values()]),
    update: (id: string, fields: any) =>
      Effect.sync(() => {
        const app = apps.get(id)
        if (!app) return
        if (fields.displayName !== undefined) app.displayName = fields.displayName as string
        if (fields.description !== undefined) app.description = fields.description as string
        if (fields.accessMode !== undefined) app.accessMode = fields.accessMode as string
        if (fields.enabled !== undefined) app.enabled = fields.enabled as boolean
        if (fields.ownerId !== undefined) app.ownerId = fields.ownerId as string
        if (fields.lastSyncedAt !== undefined) app.lastSyncedAt = fields.lastSyncedAt as string
        app.updatedAt = new Date().toISOString()
      }),
    _apps: apps, // expose for assertions
  } as any)
}

// ---------------------------------------------------------------------------
// Mock RbacRepo (in-memory)
// ---------------------------------------------------------------------------

interface MockRbacState {
  roles: Map<string, Role>
  entitlements: Map<string, Entitlement>
  attachments: Set<string>
  failCreateRole: boolean
}

function mockRbacRepo(state: MockRbacState) {
  let nextRoleId = 1
  let nextEntId = 1
  return Layer.succeed(RbacRepo, {
    createRole: (appId: string, slug: string, displayName: string, description?: string) =>
      Effect.suspend(() => {
        if (state.failCreateRole) {
          return Effect.fail({ _tag: "RbacRepoError", message: "forced", cause: null } as any)
        }
        const id = `role-${nextRoleId++}`
        const role: Role = {
          id,
          applicationId: appId,
          slug,
          displayName,
          description: description ?? null,
          maxDurationHours: null,
          createdAt: new Date().toISOString(),
        }
        state.roles.set(id, role)
        return Effect.succeed(role)
      }),
    listRoles: (appId: string) =>
      Effect.sync(() => [...state.roles.values()].filter((r) => r.applicationId === appId)),
    findRoleById: (id: string) => Effect.sync(() => state.roles.get(id) ?? null),
    deleteRole: (id: string) =>
      Effect.sync(() => {
        state.roles.delete(id)
      }),
    createEntitlement: (appId: string, slug: string, displayName: string, description?: string) =>
      Effect.sync(() => {
        const id = `ent-${nextEntId++}`
        const ent: Entitlement = {
          id,
          applicationId: appId,
          slug,
          displayName,
          description: description ?? null,
          createdAt: new Date().toISOString(),
        }
        state.entitlements.set(id, ent)
        return ent
      }),
    listEntitlements: (appId: string) =>
      Effect.sync(() => [...state.entitlements.values()].filter((e) => e.applicationId === appId)),
    findEntitlementById: (id: string) => Effect.sync(() => state.entitlements.get(id) ?? null),
    deleteEntitlement: (id: string) =>
      Effect.sync(() => {
        state.entitlements.delete(id)
      }),
    attachEntitlement: (roleId: string, entitlementId: string) =>
      Effect.sync(() => {
        state.attachments.add(`${roleId}::${entitlementId}`)
      }),
    detachEntitlement: (roleId: string, entitlementId: string) =>
      Effect.sync(() => {
        state.attachments.delete(`${roleId}::${entitlementId}`)
      }),
    listRoleEntitlements: (roleId: string) =>
      Effect.sync(() => {
        const ids = [...state.attachments]
          .filter((k) => k.startsWith(`${roleId}::`))
          .map((k) => k.split("::")[1])
        return ids.map((id) => state.entitlements.get(id)!).filter(Boolean)
      }),
    createResource: () => Effect.fail({ _tag: "RbacRepoError", message: "not used", cause: null } as any),
    listResources: () => Effect.succeed([]),
    getResourceAncestors: () => Effect.succeed([]),
  } as any)
}

function makeMockRbacState(): MockRbacState {
  return {
    roles: new Map(),
    entitlements: new Map(),
    attachments: new Set(),
    failCreateRole: false,
  }
}

// ---------------------------------------------------------------------------
// Stub SqlClient — withTransaction is identity (no rollback in pure mock)
// ---------------------------------------------------------------------------

const stubSqlClient = Layer.succeed(SqlClient.SqlClient, {
  withTransaction: (eff: any) => eff,
} as any)

// ---------------------------------------------------------------------------
// Mock OperatorClient
// ---------------------------------------------------------------------------

function mockOperatorClient(apps: ClusterApp[]) {
  return Layer.succeed(OperatorClient, {
    listApps: () => Effect.succeed(apps),
  })
}

// ---------------------------------------------------------------------------
// Helper to run sync
// ---------------------------------------------------------------------------

function runSync(operatorApps: ClusterApp[], existingApps: Application[] = [], rbacState?: MockRbacState) {
  const repoLayer = mockApplicationRepo(existingApps)
  const rbacLayer = mockRbacRepo(rbacState ?? makeMockRbacState())
  const layer = Layer.mergeAll(
    mockOperatorClient(operatorApps),
    repoLayer,
    rbacLayer,
    stubSqlClient,
    AppSyncServiceLive,
  )

  return Effect.gen(function* () {
    const sync = yield* AppSyncService
    return yield* sync.syncFromCluster()
  }).pipe(Effect.provide(layer), Effect.runPromise)
}

// ---------------------------------------------------------------------------
// Tests: Sync logic (pure Effect, no HTTP)
// ---------------------------------------------------------------------------

describe("AppSyncService", () => {
  it("creates apps that don't exist in DB", async () => {
    const result = await runSync(clusterApps)

    expect(result.created).toBe(3)
    expect(result.updated).toBe(0)
    expect(result.disabled).toBe(0)
    expect(result.total).toBe(3)
  })

  it("does not duplicate existing apps", async () => {
    const existing = [makeApp("jellyfin", "Jellyfin")]

    const result = await runSync(clusterApps, existing)

    expect(result.created).toBe(2) // gitea + grafana
    expect(result.updated).toBe(0) // jellyfin name matches
  })

  it("updates displayName when it differs", async () => {
    const existing = [makeApp("jellyfin", "Old Name")]

    const result = await runSync(clusterApps, existing)

    expect(result.updated).toBe(1)
    expect(result.created).toBe(2)
  })

  it("disables apps no longer in the cluster", async () => {
    const existing = [
      makeApp("jellyfin", "Jellyfin"),
      makeApp("removed-app", "Removed App", true),
    ]

    const result = await runSync(clusterApps, existing)

    expect(result.disabled).toBe(1)
    expect(result.created).toBe(2) // gitea + grafana
  })

  it("does not disable already-disabled apps", async () => {
    const existing = [
      makeApp("jellyfin", "Jellyfin"),
      makeApp("removed-app", "Removed App", false), // already disabled
    ]

    const result = await runSync(clusterApps, existing)

    expect(result.disabled).toBe(0) // already disabled, skip
  })

  it("handles empty cluster (disables all)", async () => {
    const existing = [
      makeApp("jellyfin", "Jellyfin"),
      makeApp("gitea", "Gitea"),
    ]

    const result = await runSync([], existing)

    expect(result.created).toBe(0)
    expect(result.disabled).toBe(2)
    expect(result.total).toBe(0)
  })

  it("handles empty DB (creates all)", async () => {
    const result = await runSync(clusterApps, [])

    expect(result.created).toBe(3)
    expect(result.disabled).toBe(0)
  })

  it("preserves governance fields on sync", async () => {
    const existing = [
      {
        ...makeApp("jellyfin", "Jellyfin"),
        accessMode: "open",
        ownerId: "admin-user",
      },
    ]

    const repoLayer = mockApplicationRepo(existing)
    const rbacLayer = mockRbacRepo(makeMockRbacState())
    const layer = Layer.mergeAll(
      mockOperatorClient(clusterApps),
      repoLayer,
      rbacLayer,
      stubSqlClient,
      AppSyncServiceLive,
    )

    await Effect.gen(function* () {
      const sync = yield* AppSyncService
      yield* sync.syncFromCluster()

      const repo = yield* ApplicationRepo
      const apps = yield* repo.list()
      const jf = apps.find((a) => a.slug === "jellyfin")!
      expect(jf.accessMode).toBe("open") // preserved
      expect(jf.ownerId).toBe("admin-user") // preserved
    }).pipe(Effect.provide(layer), Effect.runPromise)
  })

  it("seeds starter roles and entitlements when an app is first synced", async () => {
    const rbacState = makeMockRbacState()
    await runSync(clusterApps, [], rbacState)

    // 3 apps × 3 entitlements each = 9
    expect(rbacState.entitlements.size).toBe(STARTER_ENTITLEMENTS.length * clusterApps.length)
    // 3 apps × 3 roles each = 9
    expect(rbacState.roles.size).toBe(STARTER_ROLES.length * clusterApps.length)
    // 3 apps × (1 + 2 + 3) attachments per role set = 18
    const expectedAttachments = clusterApps.length * STARTER_ROLES.reduce((n, r) => n + r.entitlements.length, 0)
    expect(rbacState.attachments.size).toBe(expectedAttachments)

    // Verify slugs are correct on at least one app
    const oneAppEnts = [...rbacState.entitlements.values()].filter((e) => e.applicationId === "app-1")
    expect(new Set(oneAppEnts.map((e) => e.slug))).toEqual(new Set(["read", "write", "manage"]))
    const oneAppRoles = [...rbacState.roles.values()].filter((r) => r.applicationId === "app-1")
    expect(new Set(oneAppRoles.map((r) => r.slug))).toEqual(new Set(["viewer", "editor", "admin"]))
  })

  it("does not re-seed starter rbac when app already exists", async () => {
    const existing = [makeApp("jellyfin", "Jellyfin")]
    const rbacState = makeMockRbacState()

    await runSync(clusterApps, existing, rbacState)

    // Only the 2 newly-created apps (gitea, grafana) should be seeded.
    expect(rbacState.roles.size).toBe(STARTER_ROLES.length * 2)
    expect(rbacState.entitlements.size).toBe(STARTER_ENTITLEMENTS.length * 2)
  })

  it("writes lastSyncedAt on every sync", async () => {
    const beforeTs = new Date().toISOString()
    const existing = [makeApp("jellyfin", "Jellyfin")]
    const repoLayer = mockApplicationRepo(existing)
    const rbacLayer = mockRbacRepo(makeMockRbacState())
    const layer = Layer.mergeAll(
      mockOperatorClient(clusterApps),
      repoLayer,
      rbacLayer,
      stubSqlClient,
      AppSyncServiceLive,
    )

    await Effect.gen(function* () {
      const sync = yield* AppSyncService
      yield* sync.syncFromCluster()

      const repo = yield* ApplicationRepo
      const apps = yield* repo.list()
      for (const a of apps.filter((x) => clusterApps.some((c) => c.id === x.slug))) {
        expect(a.lastSyncedAt).not.toBeNull()
        expect(a.lastSyncedAt! >= beforeTs).toBe(true)
      }
    }).pipe(Effect.provide(layer), Effect.runPromise)
  })
})

// ---------------------------------------------------------------------------
// Tests: Transactional rollback (real DB via PGlite)
// ---------------------------------------------------------------------------

describe("AppSyncService — transactional seeding (real DB)", () => {
  // Override RbacRepo with one that fails on createEntitlement (first RBAC step).
  // If the transaction works, the application row inserted by appRepo.create
  // must be rolled back when this failure propagates.
  const FailingRbacRepo = Layer.succeed(RbacRepo, {
    createEntitlement: () =>
      Effect.fail({ _tag: "RbacRepoError", message: "forced", cause: null } as any),
    createRole: () => Effect.fail({ _tag: "RbacRepoError", message: "forced", cause: null } as any),
    attachEntitlement: () => Effect.succeed(undefined),
    listRoles: () => Effect.succeed([]),
    findRoleById: () => Effect.succeed(null),
    deleteRole: () => Effect.succeed(undefined),
    listEntitlements: () => Effect.succeed([]),
    findEntitlementById: () => Effect.succeed(null),
    deleteEntitlement: () => Effect.succeed(undefined),
    detachEntitlement: () => Effect.succeed(undefined),
    listRoleEntitlements: () => Effect.succeed([]),
    createResource: () => Effect.fail({ _tag: "RbacRepoError", message: "n/a", cause: null } as any),
    listResources: () => Effect.succeed([]),
    getResourceAncestors: () => Effect.succeed([]),
  } as any)

  it("rolls back app creation when starter rbac seed fails", { timeout: 30000 }, async () => {
    const dbLayer = makeTestDbLayer()
    const layers = Layer.mergeAll(
      mockOperatorClient([clusterApps[0]]),
      AppSyncServiceLive,
      ApplicationRepoLive,
      FailingRbacRepo,
    ).pipe(Layer.provideMerge(dbLayer))

    // Single Effect so the dbLayer is built once and shared across the
    // failed sync and the post-state assertion.
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

  it("commits app + starter rbac together when seed succeeds", { timeout: 30000 }, async () => {
    const dbLayer = makeTestDbLayer()
    const layers = Layer.mergeAll(
      mockOperatorClient([clusterApps[0]]),
      AppSyncServiceLive,
      ApplicationRepoLive,
      RbacRepoLive,
    ).pipe(Layer.provideMerge(dbLayer))

    // Single Effect so the dbLayer is built once and the same PGlite instance
    // is used for both the sync and the assertions.
    const { app, roles, ents } = await Effect.gen(function* () {
      const sync = yield* AppSyncService
      yield* sync.syncFromCluster()

      const appRepo = yield* ApplicationRepo
      const rbac = yield* RbacRepo
      const a = yield* appRepo.findBySlug("jellyfin")
      if (!a) throw new Error("app missing")
      const roles = yield* rbac.listRoles(a.id)
      const ents = yield* rbac.listEntitlements(a.id)
      return { app: a, roles, ents }
    }).pipe(Effect.provide(layers), Effect.runPromise)

    expect(app.lastSyncedAt).not.toBeNull()
    expect(new Set(roles.map((r) => r.slug))).toEqual(new Set(["viewer", "editor", "admin"]))
    expect(new Set(ents.map((e) => e.slug))).toEqual(new Set(["read", "write", "manage"]))
  })
})

// ---------------------------------------------------------------------------
// Tests: OperatorClientLive via MSW (HTTP integration)
// ---------------------------------------------------------------------------

const OPERATOR_URL = "http://operator.test:9090"

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
    }).pipe(
      Effect.provide(layer),
      Effect.runPromise,
    )

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
    }).pipe(
      Effect.provide(layer),
      Effect.either,
      Effect.runPromise,
    )

    expect(result._tag).toBe("Left")
  })
})
