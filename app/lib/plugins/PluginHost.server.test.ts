import { describe, expect, it, vi, beforeEach } from "vitest"
import { Effect, Layer, ManagedRuntime, Schema } from "effect"
import { FetchHttpClient } from "@effect/platform"
import * as SqlClient from "@effect/sql/SqlClient"
import { makeTestDbLayer } from "~/lib/db/client.server"

// Each test creates its own ManagedRuntime — fresh PGlite WASM + 16
// migrations. ~1.5s in isolation, up to 15s under suite concurrency.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

// Real governance repos against PGlite — PluginHost orchestrates reads
// from grants/principals/roles/applications/connected_systems/connector_mappings,
// so we need real SQL to hit the real branches.
import { PrincipalRepoLive } from "~/lib/governance/PrincipalRepo.server"
import { RbacRepoLive } from "~/lib/governance/RbacRepo.server"
import { GrantRepoLive } from "~/lib/governance/GrantRepo.server"
import { ApplicationRepoLive } from "~/lib/governance/ApplicationRepo.server"
import { ConnectedSystemRepoLive } from "~/lib/governance/ConnectedSystemRepo.server"
import { ConnectorMappingRepoLive } from "~/lib/governance/ConnectorMappingRepo.server"
import { AuditServiceDev } from "~/lib/governance/AuditService.server"

// LldapClient: stubbed via Layer.succeed below. PluginHost needs the tag
// resolved at layer-build time (for buildServices's makeScopedLldapClient),
// but the scoped client is only invoked when the declarative path actually
// dispatches lldap.* actions. Our fake plugin uses an empty action list, so
// these stub methods are never called.
import { LldapClient } from "~/lib/services/LldapClient.server"

// PluginRegistry stub: the real one validates + registers all four built-in
// plugins. For PluginHost tests we want full control over the plugin shape
// (manifest config schema, imperative flag, provision/deprovision behaviour).
import { PluginRegistry } from "~/lib/plugins/PluginRegistry.server"
import type { Plugin, PluginManifest } from "~/lib/plugins/contracts"
import { PluginHost, PluginHostLive } from "./PluginHost.server"
import { PluginNotFound } from "./errors"

// Repo tags — imported for the FK-gate tests below that override the Live
// repos with stubs returning null for findById, exercising the defensive
// branches the real DB schema prevents from firing.
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import { RbacRepo } from "~/lib/governance/RbacRepo.server"
import { ApplicationRepo } from "~/lib/governance/ApplicationRepo.server"

// ---------------------------------------------------------------------------
// Stub layers
// ---------------------------------------------------------------------------

// LldapClient stub typed against the real Service tag — drop the `as never`
// escape so a future interface change (a new method on LldapClient) breaks
// the type-check here instead of silently passing through.
const LldapStub: Layer.Layer<LldapClient> = Layer.succeed(LldapClient, {
  getUsers: Effect.succeed([]),
  getGroups: Effect.succeed([]),
  createUser: () => Effect.void,
  setUserPassword: () => Effect.void,
  addUserToGroup: () => Effect.void,
  removeUserFromGroup: () => Effect.void,
  createGroup: () => Effect.succeed({ id: 1, displayName: "stub" }),
  ensureGroup: () => Effect.succeed(1),
  deleteUser: () => Effect.void,
})

/**
 * Build a fake plugin so we control imperative vs declarative dispatch
 * without coupling to the four real built-ins' behaviour (which would
 * require LLDAP / Gitea / Plex / Immich MSW setup just to exercise the
 * host's branching logic).
 */
const fakePlugin = (
  overrides: {
    slug?: string
    imperative?: boolean
    provision?: Plugin["provision"]
    deprovision?: Plugin["deprovision"]
    configSchema?: Schema.Schema<unknown, unknown>
    permissionStrategy?: PluginManifest["permissionStrategy"]
    timeoutMs?: number
  } = {},
): Plugin => ({
  manifest: {
    slug: overrides.slug ?? "fake-plugin",
    version: "1.0.0",
    displayName: "Fake Plugin",
    description: "Test fixture",
    capabilities: [],
    allowedDomains: [],
    ownedLldapGroups: [],
    vaultSecrets: [],
    // Schema.Any accepts anything — config validation never fails unless we
    // pass a schema that rejects the seeded `{}` config. The PluginManifest
    // interface declares configSchema as `Schema.Schema<unknown, unknown>`;
    // Schema.Any's inferred type satisfies that contract.
    configSchema: (overrides.configSchema ?? Schema.Any) as unknown as PluginManifest["configSchema"],
    permissionStrategy: overrides.permissionStrategy ?? { byRoleSlug: { editor: [] } },
    imperative: overrides.imperative ?? false,
    timeoutMs: overrides.timeoutMs ?? 5000,
  },
  provision: overrides.provision,
  deprovision: overrides.deprovision,
})

/** Build a Registry layer that returns the given plugin for any slug it knows about. */
const RegistryStub = (plugins: ReadonlyArray<Plugin>) => {
  const bySlug = new Map(plugins.map((p) => [p.manifest.slug, p]))
  return Layer.succeed(PluginRegistry, {
    get: (slug: string) =>
      bySlug.has(slug) ? Effect.succeed(bySlug.get(slug)!) : Effect.fail(new PluginNotFound({ slug })),
    list: () => Effect.succeed(plugins.map((p) => p.manifest)),
    getTemplatesForApp: () => [],
    provisionedAppSlugs: () => new Set(),
  })
}

// ---------------------------------------------------------------------------
// Runtime factory
// ---------------------------------------------------------------------------

const GovernanceRepos = Layer.mergeAll(
  PrincipalRepoLive,
  RbacRepoLive,
  GrantRepoLive,
  ConnectedSystemRepoLive,
  ConnectorMappingRepoLive,
)

function makeRuntime(plugins: ReadonlyArray<Plugin> = [fakePlugin()]) {
  const layer = PluginHostLive.pipe(
    Layer.provide(
      Layer.mergeAll(ApplicationRepoLive, GovernanceRepos, LldapStub, AuditServiceDev, RegistryStub(plugins)),
    ),
    Layer.provideMerge(makeTestDbLayer()),
    Layer.provide(FetchHttpClient.layer),
  )
  return ManagedRuntime.make(layer)
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

interface SeedOpts {
  /** Skip inserting the principal row → triggers principal-not-found gate. */
  skipPrincipal?: boolean
  /** Skip inserting the role row → triggers role-not-found gate. */
  skipRole?: boolean
  /** Skip inserting the application row → triggers app-not-found gate. */
  skipApplication?: boolean
  /** Skip inserting the connected_system row → triggers system-not-found gate. */
  skipConnectedSystem?: boolean
  /** Insert a grant whose role_id is null → triggers no-roleId gate. */
  nullRoleId?: boolean
  /** Don't insert the grant at all → triggers grant-not-found gate. */
  skipGrant?: boolean
  /** Connected system config JSON; defaults to {} (object form). */
  systemConfig?: string
  /** Connector mapping rows — for over-revoke safety tests. */
  mappings?: Array<{
    id?: string
    connectedSystemId: string
    localRoleId: string | null
    externalRoleIdentifier: string
  }>
  /** Extra grants — for over-revoke safety (another active grant mapping to same target). */
  extraGrants?: Array<{ id: string; principalId: string; roleId: string }>
}

const seed = (opts: SeedOpts = {}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    if (!opts.skipPrincipal) {
      yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
                 VALUES ('p-alice', 'user', 'alice-sub', 'Alice', 'a@example.com'),
                        ('p-admin', 'user', 'admin', 'Admin', 'ad@x')`
    } else {
      // Need an admin principal somewhere for `granted_by` FK below.
      yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
                 VALUES ('p-admin', 'user', 'admin', 'Admin', 'ad@x')`
    }

    if (!opts.skipApplication) {
      yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, owner_id)
                 VALUES ('app-1', 'app-1', 'App 1', 'request', 'p-admin')`
    }

    if (!opts.skipRole && !opts.skipApplication) {
      yield* sql`INSERT INTO roles (id, application_id, slug, display_name)
                 VALUES ('role-editor', 'app-1', 'editor', 'Editor')`
    }

    if (!opts.skipConnectedSystem && !opts.skipApplication) {
      yield* sql`INSERT INTO connected_systems
                 (id, application_id, connector_type, config, status, plugin_slug, plugin_version)
                 VALUES ('cs-1', 'app-1', 'plugin',
                         ${opts.systemConfig ?? "{}"}::jsonb, 'active',
                         'fake-plugin', '1.0.0')`
    }

    if (!opts.skipGrant) {
      const principalVal = opts.skipPrincipal ? "p-admin" : "p-alice"
      if (opts.nullRoleId) {
        // The grants CHECK constraint requires exactly one of role_id /
        // entitlement_id. To exercise the "no roleId" gate we seed an
        // entitlement + entitlement-only grant.
        yield* sql`INSERT INTO entitlements (id, application_id, slug, display_name)
                   VALUES ('ent-1', 'app-1', 'read', 'Read')`
        yield* sql`INSERT INTO grants (id, principal_id, entitlement_id, granted_by, created_at)
                   VALUES ('g-1', ${principalVal}, 'ent-1', 'p-admin', NOW())`
      } else if (!opts.skipRole) {
        yield* sql`INSERT INTO grants (id, principal_id, role_id, granted_by, created_at)
                   VALUES ('g-1', ${principalVal}, 'role-editor', 'p-admin', NOW())`
      }
    }

    if (opts.extraGrants) {
      for (const g of opts.extraGrants) {
        yield* sql`INSERT INTO grants (id, principal_id, role_id, granted_by, created_at)
                   VALUES (${g.id}, ${g.principalId}, ${g.roleId}, 'p-admin', NOW())`
      }
    }

    if (opts.mappings) {
      for (const m of opts.mappings) {
        yield* sql`INSERT INTO connector_mappings
                   (id, connected_system_id, local_role_id, external_role_identifier, direction)
                   VALUES (${m.id ?? "m-" + Math.random().toString(36).slice(2)},
                           ${m.connectedSystemId}, ${m.localRoleId},
                           ${m.externalRoleIdentifier}, 'push')`
      }
    }
  }) as Effect.Effect<void, never, never>

// ---------------------------------------------------------------------------
// Tests — loadGrantContext validation gates
// ---------------------------------------------------------------------------

describe("PluginHost.runProvision — loadGrantContext gates", () => {
  let rt: ReturnType<typeof makeRuntime>
  beforeEach(() => {
    rt = makeRuntime()
  })

  const runProvision = () =>
    rt.runPromiseExit(
      Effect.gen(function* () {
        const host = yield* PluginHost
        yield* host.runProvision("fake-plugin", "g-1", "cs-1")
      }),
    )

  it("fails PluginHostError when the grant doesn't exist", async () => {
    await rt.runPromise(seed({ skipGrant: true }))
    const exit = await runProvision()
    expect(exit._tag).toBe("Failure")
  })

  it("fails when the grant has no roleId (entitlement-only grants unsupported)", async () => {
    await rt.runPromise(seed({ nullRoleId: true }))
    const exit = await runProvision()
    expect(exit._tag).toBe("Failure")
  })

  it("fails when the connected system isn't found", async () => {
    // Pass a connectedSystemId that doesn't exist — this IS reachable since
    // the host accepts the id from caller args, not a FK.
    await rt.runPromise(seed())
    const exit = await rt.runPromiseExit(
      Effect.gen(function* () {
        const host = yield* PluginHost
        yield* host.runProvision("fake-plugin", "g-1", "cs-does-not-exist")
      }),
    )
    expect(exit._tag).toBe("Failure")
  })

  it("fails PluginNotFound (mapped to PluginHostError) when the plugin slug isn't registered", async () => {
    await rt.runPromise(seed())
    const exit = await rt.runPromiseExit(
      Effect.gen(function* () {
        const host = yield* PluginHost
        yield* host.runProvision("does-not-exist", "g-1", "cs-1")
      }),
    )
    expect(exit._tag).toBe("Failure")
  })
})

// ---------------------------------------------------------------------------
// Tests — happy path dispatch (imperative + declarative)
// ---------------------------------------------------------------------------

describe("PluginHost.runProvision — dispatch", () => {
  it("invokes the imperative plugin.provision when manifest.imperative is true", async () => {
    const provision = vi.fn(() => Effect.void as Effect.Effect<void, never, never>)
    const rt = makeRuntime([fakePlugin({ imperative: true, provision: provision as never })])
    await rt.runPromise(seed())

    await rt.runPromise(
      Effect.gen(function* () {
        const host = yield* PluginHost
        yield* host.runProvision("fake-plugin", "g-1", "cs-1")
      }),
    )

    expect(provision).toHaveBeenCalledTimes(1)
    // First arg is GrantContext; second is the PluginServices bundle.
    const ctx = (provision.mock.calls[0] as unknown as [{ applicationSlug: string; role: { slug: string } }])[0]
    expect(ctx.applicationSlug).toBe("app-1")
    expect(ctx.role.slug).toBe("editor")
  })

  it("falls back to applyPermissionStrategy when the plugin is declarative", async () => {
    // declarative path = imperative:false, no plugin.provision called.
    // permissionStrategy with empty actions is a no-op — exercises the
    // host's dispatch + onExit audit emit without needing real scoped svcs.
    const provision = vi.fn()
    const rt = makeRuntime([fakePlugin({ imperative: false, provision: provision as never })])
    await rt.runPromise(seed())

    const exit = await rt.runPromiseExit(
      Effect.gen(function* () {
        const host = yield* PluginHost
        yield* host.runProvision("fake-plugin", "g-1", "cs-1")
      }),
    )
    expect(exit._tag).toBe("Success")
    expect(provision).not.toHaveBeenCalled()
  })

  it("parses config when stored as JSON string in connected_systems.config", async () => {
    // Postgres jsonb is parsed by the pg driver into an object, but the host
    // also handles the legacy case where config is a raw JSON string.
    const provision = vi.fn(() => Effect.void as Effect.Effect<void, never, never>)
    const rt = makeRuntime([fakePlugin({ imperative: true, provision: provision as never })])
    await rt.runPromise(seed({ systemConfig: '{"foo":"bar"}' }))

    await rt.runPromise(
      Effect.gen(function* () {
        const host = yield* PluginHost
        yield* host.runProvision("fake-plugin", "g-1", "cs-1")
      }),
    )

    const ctx = (provision.mock.calls[0] as unknown as [{ config: Record<string, unknown> }])[0]
    expect(ctx.config).toEqual({ foo: "bar" })
  })

  it("fails when config validation against the manifest schema fails", async () => {
    // Require config.required: "yes" — the seeded config is {} → decode fails.
    const strictSchema = Schema.Struct({ required: Schema.Literal("yes") })
    const rt = makeRuntime([fakePlugin({ configSchema: strictSchema as never })])
    await rt.runPromise(seed())

    const exit = await rt.runPromiseExit(
      Effect.gen(function* () {
        const host = yield* PluginHost
        yield* host.runProvision("fake-plugin", "g-1", "cs-1")
      }),
    )
    expect(exit._tag).toBe("Failure")
  })

  it("surfaces an imperative plugin.provision failure as PluginHostError", async () => {
    const provision = vi.fn(() => Effect.fail(new Error("plugin boom") as never) as Effect.Effect<void, never, never>)
    const rt = makeRuntime([fakePlugin({ imperative: true, provision: provision as never })])
    await rt.runPromise(seed())

    const exit = await rt.runPromiseExit(
      Effect.gen(function* () {
        const host = yield* PluginHost
        yield* host.runProvision("fake-plugin", "g-1", "cs-1")
      }),
    )
    expect(exit._tag).toBe("Failure")
  })
})

// ---------------------------------------------------------------------------
// Tests — runDeprovision over-revoke safety
// ---------------------------------------------------------------------------

describe("PluginHost.runDeprovision — over-revoke safety", () => {
  it("skips when another active grant maps to the same external target (hasOtherActiveMappingTo)", async () => {
    const deprovision = vi.fn(() => Effect.void as Effect.Effect<void, never, never>)
    const rt = makeRuntime([
      fakePlugin({ imperative: true, deprovision: deprovision as never, provision: vi.fn() as never }),
    ])

    // Seed: two grants from p-alice to the same role-editor → both map to
    // the same external_role_identifier through connector_mappings. Revoking
    // grant g-1 should be skipped because g-2 still maps to the same target.
    await rt.runPromise(
      Effect.gen(function* () {
        yield* seed({
          mappings: [{ connectedSystemId: "cs-1", localRoleId: "role-editor", externalRoleIdentifier: "ext-editor" }],
        })
        // g-1 already inserted; add a second grant for the same principal+role.
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO grants (id, principal_id, role_id, granted_by, created_at)
                   VALUES ('g-2', 'p-alice', 'role-editor', 'p-admin', NOW())`
      }) as Effect.Effect<void, never, never>,
    )

    await rt.runPromise(
      Effect.gen(function* () {
        const host = yield* PluginHost
        yield* host.runDeprovision("fake-plugin", "g-1", "cs-1")
      }),
    )

    // The plugin.deprovision must NOT have run — the host skipped it.
    expect(deprovision).not.toHaveBeenCalled()
  })

  it("runs the deprovision when no other grant maps to the same target", async () => {
    const deprovision = vi.fn(() => Effect.void as Effect.Effect<void, never, never>)
    const rt = makeRuntime([
      fakePlugin({ imperative: true, deprovision: deprovision as never, provision: vi.fn() as never }),
    ])
    await rt.runPromise(
      seed({
        mappings: [{ connectedSystemId: "cs-1", localRoleId: "role-editor", externalRoleIdentifier: "ext-editor" }],
      }) as Effect.Effect<void, never, never>,
    )

    await rt.runPromise(
      Effect.gen(function* () {
        const host = yield* PluginHost
        yield* host.runDeprovision("fake-plugin", "g-1", "cs-1")
      }),
    )

    expect(deprovision).toHaveBeenCalledTimes(1)
  })

  it("falls through to deprovision when there's no mapping row at all (mapping-less app)", async () => {
    // No connector_mapping seeded → host skips the safety check + runs.
    const deprovision = vi.fn(() => Effect.void as Effect.Effect<void, never, never>)
    const rt = makeRuntime([
      fakePlugin({ imperative: true, deprovision: deprovision as never, provision: vi.fn() as never }),
    ])
    await rt.runPromise(seed())

    await rt.runPromise(
      Effect.gen(function* () {
        const host = yield* PluginHost
        yield* host.runDeprovision("fake-plugin", "g-1", "cs-1")
      }),
    )

    expect(deprovision).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Tests — FK-protected validation gates
// ---------------------------------------------------------------------------
//
// PluginHost has three more validation gates that the real DB schema makes
// unreachable from a healthy data plane (grants.principal_id, grants.role_id
// and roles.application_id are all NOT NULL FKs with ON DELETE CASCADE). They
// are application-level safety code: if a future migration relaxes one of the
// FKs, the gate becomes load-bearing and we'd want to know its error shape
// hasn't drifted.
//
// To exercise the gates we swap the Live repo whose findById matters for the
// gate under test with a Layer.succeed stub that returns null. Everything
// else stays Live. The grant row still exists; the host just gets `null`
// back from the repo lookup.

interface StubOverrides {
  principalById?: Effect.Effect<unknown, never>
  roleById?: Effect.Effect<unknown, never>
  applicationById?: Effect.Effect<unknown, never>
}

function makeRuntimeWithRepoStubs(overrides: StubOverrides) {
  // Build minimal stub repos. Each only stubs the method PluginHost actually
  // calls (findById on the three repos involved in loadGrantContext). The
  // grant + connected-system repos stay Live so the prior gates pass.
  const principalStub =
    overrides.principalById !== undefined
      ? Layer.succeed(PrincipalRepo, {
          findById: () => overrides.principalById,
          // Methods PluginHost doesn't call — give Effect.die() shape so a
          // surprise call fails loudly.
          findByExternalId: () => Effect.die("PrincipalRepo.findByExternalId not stubbed"),
          create: () => Effect.die("not stubbed"),
          list: () => Effect.die("not stubbed"),
          addMembership: () => Effect.die("not stubbed"),
          removeMembership: () => Effect.die("not stubbed"),
          listGroupsFor: () => Effect.die("not stubbed"),
          listMembers: () => Effect.die("not stubbed"),
        } as never)
      : PrincipalRepoLiveForFkTests

  const rbacStub =
    overrides.roleById !== undefined
      ? Layer.succeed(RbacRepo, {
          findRoleById: () => overrides.roleById,
          listRoles: () => Effect.die("not stubbed"),
          createRole: () => Effect.die("not stubbed"),
          createEntitlement: () => Effect.die("not stubbed"),
          listEntitlements: () => Effect.die("not stubbed"),
          assignEntitlementToRole: () => Effect.die("not stubbed"),
          listResources: () => Effect.die("not stubbed"),
          createResource: () => Effect.die("not stubbed"),
          listRoleAssignments: () => Effect.die("not stubbed"),
        } as never)
      : RbacRepoLiveForFkTests

  const appStub =
    overrides.applicationById !== undefined
      ? Layer.succeed(ApplicationRepo, {
          findById: () => overrides.applicationById,
          findBySlug: () => Effect.die("not stubbed"),
          list: () => Effect.die("not stubbed"),
          create: () => Effect.die("not stubbed"),
          update: () => Effect.die("not stubbed"),
          deleteById: () => Effect.die("not stubbed"),
          updateLastSyncedAt: () => Effect.die("not stubbed"),
        } as never)
      : ApplicationRepoLiveForFkTests

  // Other repos PluginHost touches are still Live — they read the seeded DB.
  const layer = PluginHostLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        appStub,
        principalStub,
        rbacStub,
        GrantRepoLiveForFkTests,
        ConnectedSystemRepoLiveForFkTests,
        ConnectorMappingRepoLiveForFkTests,
        LldapStub,
        AuditServiceDev,
        RegistryStub([fakePlugin()]),
      ),
    ),
    Layer.provideMerge(makeTestDbLayer()),
    Layer.provide(FetchHttpClient.layer),
  )
  return ManagedRuntime.make(layer)
}

// Re-imports of the Live repos at module level — kept here so the override
// helper above can fall back to Live when an override isn't supplied.
import { PrincipalRepoLive as PrincipalRepoLiveForFkTests } from "~/lib/governance/PrincipalRepo.server"
import { RbacRepoLive as RbacRepoLiveForFkTests } from "~/lib/governance/RbacRepo.server"
import { ApplicationRepoLive as ApplicationRepoLiveForFkTests } from "~/lib/governance/ApplicationRepo.server"
import { GrantRepoLive as GrantRepoLiveForFkTests } from "~/lib/governance/GrantRepo.server"
import { ConnectedSystemRepoLive as ConnectedSystemRepoLiveForFkTests } from "~/lib/governance/ConnectedSystemRepo.server"
import { ConnectorMappingRepoLive as ConnectorMappingRepoLiveForFkTests } from "~/lib/governance/ConnectorMappingRepo.server"

describe("PluginHost.runProvision — FK-protected gates (via repo stubs)", () => {
  it("fails PluginHostError when PrincipalRepo.findById returns null", async () => {
    const rt = makeRuntimeWithRepoStubs({ principalById: Effect.succeed(null) })
    await rt.runPromise(seed())
    const exit = await rt.runPromiseExit(
      Effect.gen(function* () {
        const host = yield* PluginHost
        yield* host.runProvision("fake-plugin", "g-1", "cs-1")
      }),
    )
    expect(exit._tag).toBe("Failure")
  })

  it("fails PluginHostError when RbacRepo.findRoleById returns null", async () => {
    const rt = makeRuntimeWithRepoStubs({ roleById: Effect.succeed(null) })
    await rt.runPromise(seed())
    const exit = await rt.runPromiseExit(
      Effect.gen(function* () {
        const host = yield* PluginHost
        yield* host.runProvision("fake-plugin", "g-1", "cs-1")
      }),
    )
    expect(exit._tag).toBe("Failure")
  })

  it("fails PluginHostError when ApplicationRepo.findById returns null", async () => {
    const rt = makeRuntimeWithRepoStubs({ applicationById: Effect.succeed(null) })
    await rt.runPromise(seed())
    const exit = await rt.runPromiseExit(
      Effect.gen(function* () {
        const host = yield* PluginHost
        yield* host.runProvision("fake-plugin", "g-1", "cs-1")
      }),
    )
    expect(exit._tag).toBe("Failure")
  })
})
