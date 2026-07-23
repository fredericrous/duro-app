import { Layer } from "effect"
import { FetchHttpClient } from "@effect/platform"
import { LldapUserManagerLive } from "./LldapClient.server"
import { VaultCertManagerLive } from "./VaultPki.server"
import { EmailServiceLive, EmailServiceDev } from "./EmailService.server"
import { OidcClientLive, OidcClientDev } from "./OidcClient.server"
import { CertManagerDev } from "./CertManager.server"
import { UserManagerDev } from "./UserManager.server"
import { InviteRepoLive } from "./InviteRepo.server"
import { PreferencesRepoLive } from "./PreferencesRepo.server"
import { CertificateRepoLive } from "./CertificateRepo.server"
import { CertRevealRepoLive } from "./CertRevealRepo.server"
import { RecoveryRepoLive } from "./RecoveryRepo.server"
import { DiscordNotifierLive } from "./DiscordNotifier.server"
import { DbLive, DbDevLive, makeEmbeddedDbLayer } from "~/lib/db/client.server"
import { OtelLayer } from "~/lib/telemetry.server"

// Governance services
import { PrincipalRepoLive } from "~/lib/governance/PrincipalRepo.server"
import { ApplicationRepoLive } from "~/lib/governance/ApplicationRepo.server"
import { RbacRepoLive } from "~/lib/governance/RbacRepo.server"
import { GrantRepoLive } from "~/lib/governance/GrantRepo.server"
import { ConnectedSystemRepoLive } from "~/lib/governance/ConnectedSystemRepo.server"
import { ConnectorMappingRepoLive } from "~/lib/governance/ConnectorMappingRepo.server"
import { AuthzEngineLive } from "~/lib/governance/AuthzEngine.server"
import { AccessRequestRepoLive } from "~/lib/governance/AccessRequestRepo.server"
import { AccessInvitationRepoLive } from "~/lib/governance/AccessInvitationRepo.server"
import { AuditServiceLive, AuditServiceDev } from "~/lib/governance/AuditService.server"
import { ApiKeyRepoLive } from "~/lib/governance/ApiKeyRepo.server"
import { ProvisioningServiceLive, ProvisioningServiceDev } from "~/lib/governance/ProvisioningService.server"
import { GroupSyncServiceLive } from "~/lib/governance/GroupSyncService.server"
import { GroupMappingRepoLive } from "~/lib/governance/GroupMappingRepo.server"
import { OperatorClientLive, OperatorClientDev } from "./OperatorClient.server"
import { AppSyncServiceLive } from "~/lib/governance/AppSyncService.server"

// Plugin system
import { PluginRegistryLive } from "~/lib/plugins/PluginRegistry.server"
import { PluginHostLive } from "~/lib/plugins/PluginHost.server"
import { LldapClientLive } from "~/lib/services/LldapClient.server"

const isDevServer = process.env.NODE_ENV === "development" && process.env.VITEST !== "true"

// DB layer selection:
//  - DURO_DB_PATH set  → embedded file-backed PGlite (chart's `mode: embedded`),
//    a single-pod deployment with no external Postgres.
//  - dev server        → in-memory PGlite + dev seed.
//  - otherwise (prod)  → real Postgres via DATABASE_URL.
const embeddedDbPath = process.env.DURO_DB_PATH
// Exported so the runtime can build a DB-only ManagedRuntime that shares this
// exact layer (one pool) with the full app runtime — see runtime.server.ts.
export const AppDbLive = embeddedDbPath ? makeEmbeddedDbLayer(embeddedDbPath) : isDevServer ? DbDevLive : DbLive

// Shared governance repos — extracted as a single Layer value so both the
// outer AppLayer merge and the PluginHostWired sub-provide resolve to the
// SAME memoized build. Same-value references = one build in Effect's Layer.
const GovernanceRepos = Layer.mergeAll(
  PrincipalRepoLive,
  RbacRepoLive,
  GrantRepoLive,
  ConnectedSystemRepoLive,
  ConnectorMappingRepoLive,
)

// PluginHostLive depends on governance repos, LldapClient, AuditService,
// ApplicationRepo, and PluginRegistry. Build a dedicated wired layer so
// its Service Tag stays dependency-free and callers only need PluginHost.
const PluginHostWired = PluginHostLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      GovernanceRepos,
      ApplicationRepoLive,
      PluginRegistryLive,
      LldapClientLive,
      isDevServer ? AuditServiceDev : AuditServiceLive,
    ),
  ),
)

export const AppLayer = Layer.mergeAll(
  // Existing services
  isDevServer ? UserManagerDev : LldapUserManagerLive,
  isDevServer ? CertManagerDev : VaultCertManagerLive,
  isDevServer ? EmailServiceDev : EmailServiceLive,
  isDevServer ? OidcClientDev : OidcClientLive,
  InviteRepoLive,
  PreferencesRepoLive,
  CertificateRepoLive,
  CertRevealRepoLive,
  RecoveryRepoLive,
  DiscordNotifierLive,
  // Governance services
  ApplicationRepoLive,
  GovernanceRepos,
  AuthzEngineLive,
  AccessRequestRepoLive,
  AccessInvitationRepoLive,
  isDevServer ? AuditServiceDev : AuditServiceLive,
  ApiKeyRepoLive,
  isDevServer ? ProvisioningServiceDev : ProvisioningServiceLive,
  GroupSyncServiceLive,
  GroupMappingRepoLive,
  isDevServer ? OperatorClientDev : OperatorClientLive,
  AppSyncServiceLive,
  // Plugin system
  PluginRegistryLive,
  isDevServer ? PluginHostWired : PluginHostWired,
).pipe(Layer.provideMerge(AppDbLive), Layer.provide(OtelLayer), Layer.provide(FetchHttpClient.layer))
