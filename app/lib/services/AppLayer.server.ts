import { Layer } from "effect"
import { FetchHttpClient } from "@effect/platform"
import { LldapUserManagerLive } from "./LldapClient.server"
import { VaultCertManagerLive } from "./VaultPki.server"
import { EmailServiceLive } from "./EmailService.server"
import { InviteRepoLive } from "./InviteRepo.server"
import { PreferencesRepoLive } from "./PreferencesRepo.server"
import { DbLive } from "~/lib/db/client.server"
import { OtelLayer } from "~/lib/telemetry.server"

export const AppLayer = Layer.mergeAll(LldapUserManagerLive, VaultCertManagerLive, EmailServiceLive, InviteRepoLive, PreferencesRepoLive).pipe(
  Layer.provide(DbLive),
  Layer.provide(OtelLayer),
  Layer.provide(FetchHttpClient.layer),
)
