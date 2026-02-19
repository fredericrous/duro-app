import { Layer } from "effect"
import { FetchHttpClient } from "@effect/platform"
import { LldapClientLive } from "./LldapClient.server"
import { VaultPkiLive } from "./VaultPki.server"
import { EmailServiceLive } from "./EmailService.server"
import { InviteRepoLive } from "./InviteRepo.server"
import { DbLive } from "~/lib/db/client.server"
import { OtelLayer } from "~/lib/telemetry.server"

export const AppLayer = Layer.mergeAll(LldapClientLive, VaultPkiLive, EmailServiceLive, InviteRepoLive).pipe(
  Layer.provide(DbLive),
  Layer.provide(OtelLayer),
  Layer.provide(FetchHttpClient.layer),
)
