import { Layer } from "effect"
import { LldapClientLive } from "./LldapClient.server"
import { VaultPkiLive } from "./VaultPki.server"
import { GitHubClientLive } from "./GitHubClient.server"
import { EmailServiceLive } from "./EmailService.server"
import { InviteRepoLive } from "./InviteRepo.server"
import { OtelLayer } from "~/lib/telemetry.server"

export const AppLayer = Layer.mergeAll(
  LldapClientLive,
  VaultPkiLive,
  GitHubClientLive,
  EmailServiceLive,
  InviteRepoLive,
).pipe(Layer.provide(OtelLayer))
