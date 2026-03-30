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
import { DbLive, DbDevLive } from "~/lib/db/client.server"
import { OtelLayer } from "~/lib/telemetry.server"

// Governance services
import { PrincipalRepoLive } from "~/lib/governance/PrincipalRepo.server"
import { ApplicationRepoLive } from "~/lib/governance/ApplicationRepo.server"
import { RbacRepoLive } from "~/lib/governance/RbacRepo.server"
import { GrantRepoLive } from "~/lib/governance/GrantRepo.server"
import { AuthzEngineLive } from "~/lib/governance/AuthzEngine.server"
import { AccessRequestRepoLive } from "~/lib/governance/AccessRequestRepo.server"
import { AccessInvitationRepoLive } from "~/lib/governance/AccessInvitationRepo.server"
import { AuditServiceLive, AuditServiceDev } from "~/lib/governance/AuditService.server"
import { ApiKeyRepoLive } from "~/lib/governance/ApiKeyRepo.server"
import { ProvisioningServiceLive, ProvisioningServiceDev } from "~/lib/governance/ProvisioningService.server"
import { GroupSyncServiceLive } from "~/lib/governance/GroupSyncService.server"
import { OperatorClientLive, OperatorClientDev } from "./OperatorClient.server"
import { AppSyncServiceLive } from "~/lib/governance/AppSyncService.server"

const isDevServer = process.env.NODE_ENV === "development" && process.env.VITEST !== "true"

export const AppLayer = Layer.mergeAll(
  // Existing services
  isDevServer ? UserManagerDev : LldapUserManagerLive,
  isDevServer ? CertManagerDev : VaultCertManagerLive,
  isDevServer ? EmailServiceDev : EmailServiceLive,
  isDevServer ? OidcClientDev : OidcClientLive,
  InviteRepoLive,
  PreferencesRepoLive,
  CertificateRepoLive,
  // Governance services
  PrincipalRepoLive,
  ApplicationRepoLive,
  RbacRepoLive,
  GrantRepoLive,
  AuthzEngineLive,
  AccessRequestRepoLive,
  AccessInvitationRepoLive,
  isDevServer ? AuditServiceDev : AuditServiceLive,
  ApiKeyRepoLive,
  isDevServer ? ProvisioningServiceDev : ProvisioningServiceLive,
  GroupSyncServiceLive,
  isDevServer ? OperatorClientDev : OperatorClientLive,
  AppSyncServiceLive,
).pipe(
  Layer.provideMerge(isDevServer ? DbDevLive : DbLive),
  Layer.provide(OtelLayer),
  Layer.provide(FetchHttpClient.layer),
)
