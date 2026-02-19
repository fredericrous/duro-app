import { Layer } from "effect"
import { FetchHttpClient } from "@effect/platform"
import { VaultPkiLive } from "./VaultPki.server"
import { GitHubClientLive } from "./GitHubClient.server"
import { EmailServiceLive } from "./EmailService.server"
import { InviteRepoLive } from "./InviteRepo.server"
import { DbLive } from "~/lib/db/client.server"
import { OtelLayer } from "~/lib/telemetry.server"

export const WorkerLayer = Layer.mergeAll(
  VaultPkiLive,
  GitHubClientLive,
  EmailServiceLive,
  InviteRepoLive,
).pipe(
  Layer.provide(DbLive),
  Layer.provide(OtelLayer),
  Layer.provide(FetchHttpClient.layer),
)
