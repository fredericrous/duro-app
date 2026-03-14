import { Layer } from "effect"
import { FetchHttpClient } from "@effect/platform"
import { LldapUserManagerLive } from "./LldapClient.server"
import { VaultCertManagerLive } from "./VaultPki.server"
import { EmailServiceLive, EmailServiceDev } from "./EmailService.server"
import { OidcClientLive, OidcClientDev } from "./OidcClient.server"
import { InviteRepoLive } from "./InviteRepo.server"
import { PreferencesRepoLive } from "./PreferencesRepo.server"
import { CertificateRepoLive } from "./CertificateRepo.server"
import { DbLive } from "~/lib/db/client.server"
import { OtelLayer } from "~/lib/telemetry.server"

const isDevServer = process.env.NODE_ENV === "development" && process.env.VITEST !== "true"

export const AppLayer = Layer.mergeAll(
  LldapUserManagerLive,
  VaultCertManagerLive,
  isDevServer ? EmailServiceDev : EmailServiceLive,
  isDevServer ? OidcClientDev : OidcClientLive,
  InviteRepoLive,
  PreferencesRepoLive,
  CertificateRepoLive,
).pipe(Layer.provide(DbLive), Layer.provide(OtelLayer), Layer.provide(FetchHttpClient.layer))
