import { Effect, Layer, ManagedRuntime } from "effect"
import { FetchHttpClient } from "@effect/platform"
import * as SqlClient from "@effect/sql/SqlClient"
import { makeTestDbLayer } from "~/lib/db/client.server"

// Governance — all Live; tests run real Effect against real PGlite.
import { PrincipalRepoLive } from "~/lib/governance/PrincipalRepo.server"
import { ApplicationRepoLive } from "~/lib/governance/ApplicationRepo.server"
import { RbacRepoLive } from "~/lib/governance/RbacRepo.server"
import { GrantRepoLive } from "~/lib/governance/GrantRepo.server"
import { ConnectedSystemRepoLive } from "~/lib/governance/ConnectedSystemRepo.server"
import { ConnectorMappingRepoLive } from "~/lib/governance/ConnectorMappingRepo.server"
import { AuthzEngineLive } from "~/lib/governance/AuthzEngine.server"
import { AccessRequestRepoLive } from "~/lib/governance/AccessRequestRepo.server"
import { AccessInvitationRepoLive } from "~/lib/governance/AccessInvitationRepo.server"
import { AuditServiceDev } from "~/lib/governance/AuditService.server"
import { ApiKeyRepoLive } from "~/lib/governance/ApiKeyRepo.server"
import { ProvisioningServiceDev } from "~/lib/governance/ProvisioningService.server"
import { GroupSyncServiceLive } from "~/lib/governance/GroupSyncService.server"
import { GroupMappingRepoLive } from "~/lib/governance/GroupMappingRepo.server"
import { AppSyncServiceLive } from "~/lib/governance/AppSyncService.server"

// Services — Live repos, Dev variants of external clients. No real HTTP/LDAP/Vault.
import { InviteRepoLive } from "~/lib/services/InviteRepo.server"
import { PreferencesRepoLive } from "~/lib/services/PreferencesRepo.server"
import { CertificateRepoLive } from "~/lib/services/CertificateRepo.server"
import { CertRevealRepoLive } from "~/lib/services/CertRevealRepo.server"
import { RecoveryRepoLive } from "~/lib/services/RecoveryRepo.server"
import { CertManagerDev } from "~/lib/services/CertManager.server"
import { EmailServiceDev } from "~/lib/services/EmailService.server"
import { OidcClientDev } from "~/lib/services/OidcClient.server"
import { OperatorClientDev } from "~/lib/services/OperatorClient.server"
import { UserManagerDev } from "~/lib/services/UserManager.server"

// Plugins
import { PluginRegistryLive } from "~/lib/plugins/PluginRegistry.server"

/**
 * Test AppLayer: mirrors production AppLayer but swaps the DB for PGlite
 * (in-memory) and external clients for their Dev variants. Repos themselves
 * are all Live — tests exercise real SQL against the in-memory database.
 *
 * Use this when you want a route loader/action to run end-to-end without
 * hand-crafted mocks. Seed via `seedTestDb(effect)`, call the loader, assert.
 */
const GovernanceRepos = Layer.mergeAll(
  PrincipalRepoLive,
  RbacRepoLive,
  GrantRepoLive,
  ConnectedSystemRepoLive,
  ConnectorMappingRepoLive,
)

// PluginHost intentionally NOT included by default. It pulls LldapClientLive
// which reads LLDAP_ADMIN_PASS from the environment, and the tests that don't
// exercise plugin provisioning shouldn't be forced to set that. Tests that
// need PluginHost can compose it via Layer.provideMerge over `TestAppLayer`.

export const TestAppLayer = Layer.mergeAll(
  UserManagerDev,
  CertManagerDev,
  EmailServiceDev,
  OidcClientDev,
  InviteRepoLive,
  PreferencesRepoLive,
  CertificateRepoLive,
  CertRevealRepoLive,
  RecoveryRepoLive,
  ApplicationRepoLive,
  GovernanceRepos,
  AuthzEngineLive,
  AccessRequestRepoLive,
  AccessInvitationRepoLive,
  AuditServiceDev,
  ApiKeyRepoLive,
  ProvisioningServiceDev,
  GroupSyncServiceLive,
  GroupMappingRepoLive,
  OperatorClientDev,
  AppSyncServiceLive,
  PluginRegistryLive,
).pipe(Layer.provideMerge(makeTestDbLayer()), Layer.provide(FetchHttpClient.layer))

// Lazily-built singleton runtime. Cheap to keep across tests within a file:
// the PGlite layer is built once per ManagedRuntime; truncating between tests
// gives us a clean DB without rebuilding the runtime.
let runtime: ManagedRuntime.ManagedRuntime<unknown, never> | null = null

function getRuntime(): ManagedRuntime.ManagedRuntime<unknown, never> {
  if (!runtime) {
    runtime = ManagedRuntime.make(TestAppLayer) as ManagedRuntime.ManagedRuntime<unknown, never>
  }
  return runtime
}

/**
 * `runEffect` replacement bound to the test AppLayer. Use this in a
 * `vi.mock("~/lib/runtime.server", ...)` so route loaders/actions execute
 * against the real test runtime instead of needing per-call mocks.
 */
// `any` requirements: the runtime provides every service in TestAppLayer
// (SqlClient + all repos + dev clients). Narrowing the requirement type would
// just force every test call site to assert which layer services they touch.
export function testRunEffect<A, E>(effect: Effect.Effect<A, E, any>): Promise<A> {
  return getRuntime().runPromise(effect) as Promise<A>
}

/**
 * Wipe every data table between tests. Call from `beforeEach` to keep tests
 * isolated. The PGlite instance + migration state is preserved (fast).
 *
 * SQL kept in sync with `makeTestDbLayer()` in `app/lib/db/client.server.ts`.
 */
export function truncateAll(): Promise<void> {
  return testRunEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`TRUNCATE
        provisioning_jobs, connector_mappings, connected_systems,
        api_keys, audit_events, access_invitations,
        request_approvals, access_requests, approval_policies,
        grants, role_entitlements, entitlements, roles, resources,
        group_mappings, applications, group_memberships, principals,
        invites, user_revocations, user_preferences, user_certificates,
        recovery_requests
        RESTART IDENTITY CASCADE`
    }) as Effect.Effect<void, never, never>,
  )
}

/**
 * Run an arbitrary seeding Effect against the test DB. Thin wrapper around
 * `testRunEffect` named for intent — readability matters in test files.
 */
export function seedTestDb<A, E>(effect: Effect.Effect<A, E, any>): Promise<A> {
  return testRunEffect(effect)
}

/** Tear down the runtime (call from `afterAll` if you want a fully fresh runtime per file). */
export async function disposeTestRuntime(): Promise<void> {
  if (runtime) {
    await runtime.dispose()
    runtime = null
  }
}
