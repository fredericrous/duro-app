/**
 * Typed test fixture builders.
 *
 * Each `mk*` function returns a complete instance of the corresponding
 * production type, accepting a `Partial` of fields the test wants to
 * override. The goal is to keep test bodies short while making sure that
 * if the production type adds a required field, the factory (and so every
 * test using it) gets a compile error rather than silently lying via
 * `as never`.
 */
import type { Application, Entitlement, Grant, Principal, Role } from "~/lib/governance/types"
import type { Plugin, PluginManifest } from "~/lib/plugins/contracts"
import { Effect, Schema } from "effect"

// ---------------------------------------------------------------------------
// Service-tag stub helper
// ---------------------------------------------------------------------------

/**
 * Build a stub implementation for an Effect Service tag where only a few
 * methods need real behaviour. Unstubbed methods return Effect.die so a
 * surprise call by future production code fails loudly at the call site.
 *
 * Use with `Layer.succeed(MyTag, makeStubService<MyTag.Service>({ ... }))`.
 *
 * @example
 *   Layer.succeed(PrincipalRepo, makeStubService<PrincipalRepoService>({
 *     findById: () => Effect.succeed(null),
 *   }))
 */
export function makeStubService<T extends object>(overrides: Partial<T>): T {
  return new Proxy(overrides, {
    get(target, prop) {
      if (prop in target) return (target as Record<string | symbol, unknown>)[prop]
      return () => Effect.die(`${String(prop)}: not stubbed in test`)
    },
  }) as T
}

// ---------------------------------------------------------------------------
// Governance row fixtures
// ---------------------------------------------------------------------------

export const mkPrincipal = (overrides: Partial<Principal> = {}): Principal => ({
  id: "p-test",
  principalType: "user",
  externalId: "test-sub",
  displayName: "Test User",
  email: "test@example.com",
  enabled: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...overrides,
})

export const mkApplication = (overrides: Partial<Application> = {}): Application => ({
  id: "app-test",
  slug: "test-app",
  displayName: "Test App",
  description: null,
  accessMode: "request",
  ownerId: "p-admin",
  enabled: true,
  url: null,
  lastSyncedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...overrides,
})

export const mkRole = (overrides: Partial<Role> = {}): Role => ({
  id: "role-test",
  applicationId: "app-test",
  slug: "viewer",
  displayName: "Viewer",
  description: null,
  maxDurationHours: null,
  createdAt: "2026-01-01T00:00:00Z",
  ...overrides,
})

export const mkEntitlement = (overrides: Partial<Entitlement> = {}): Entitlement => ({
  id: "ent-test",
  applicationId: "app-test",
  slug: "view",
  displayName: "View",
  description: null,
  createdAt: "2026-01-01T00:00:00Z",
  ...overrides,
})

export const mkGrant = (overrides: Partial<Grant> = {}): Grant => ({
  id: "g-test",
  principalId: "p-test",
  roleId: "role-test",
  entitlementId: null,
  resourceId: null,
  grantedBy: "p-admin",
  reason: null,
  expiresAt: null,
  revokedAt: null,
  revokedBy: null,
  createdAt: "2026-01-01T00:00:00Z",
  ...overrides,
})

// ---------------------------------------------------------------------------
// Plugin fixtures
// ---------------------------------------------------------------------------

interface FakePluginOptions {
  slug?: string
  imperative?: boolean
  provision?: Plugin["provision"]
  deprovision?: Plugin["deprovision"]
  configSchema?: Schema.Schema<unknown, unknown>
  permissionStrategy?: PluginManifest["permissionStrategy"]
  timeoutMs?: number
}

/**
 * Build a complete Plugin for tests that exercise PluginHost without
 * coupling to the four real built-ins.
 *
 * configSchema defaults to Schema.Any (accepts every input). The narrow
 * `unknown as PluginManifest["configSchema"]` cast is the only escape
 * still needed — Effect's Schema generics use position-sensitive type
 * parameters that don't infer cleanly from Schema.Any.
 */
export const mkFakePlugin = (overrides: FakePluginOptions = {}): Plugin => ({
  manifest: {
    slug: overrides.slug ?? "fake-plugin",
    version: "1.0.0",
    displayName: "Fake Plugin",
    description: "Test fixture",
    capabilities: [],
    allowedDomains: [],
    ownedLldapGroups: [],
    vaultSecrets: [],
    configSchema: (overrides.configSchema ?? Schema.Any) as unknown as PluginManifest["configSchema"],
    permissionStrategy: overrides.permissionStrategy ?? { byRoleSlug: { editor: [] } },
    imperative: overrides.imperative ?? false,
    timeoutMs: overrides.timeoutMs ?? 5000,
  },
  provision: overrides.provision,
  deprovision: overrides.deprovision,
})
