import { ManagedRuntime, type Effect } from "effect"
import { AppLayer } from "./services/AppLayer.server"
import type { LldapClient } from "./services/LldapClient.server"
import type { VaultPki } from "./services/VaultPki.server"
import type { GitHubClient } from "./services/GitHubClient.server"
import type { EmailService } from "./services/EmailService.server"
import type { InviteRepo } from "./services/InviteRepo.server"
import { reconcileLoop } from "./reconciler.server"

type AppServices =
  | LldapClient
  | VaultPki
  | GitHubClient
  | EmailService
  | InviteRepo

const appRuntime = ManagedRuntime.make(AppLayer)

// Start the background reconciler (polls for PR merges, sends emails)
appRuntime.runFork(reconcileLoop)

export function runEffect<A, E>(
  effect: Effect.Effect<A, E, AppServices>,
): Promise<A> {
  return appRuntime.runPromise(effect) as Promise<A>
}
