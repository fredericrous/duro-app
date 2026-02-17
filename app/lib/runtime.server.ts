import { ManagedRuntime, type Effect } from "effect"
import type { WorkflowEngine } from "@effect/workflow"
import { AppLayer } from "./services/AppLayer.server"
import type { LldapClient } from "./services/LldapClient.server"
import type { VaultPki } from "./services/VaultPki.server"
import type { GitHubClient } from "./services/GitHubClient.server"
import type { EmailService } from "./services/EmailService.server"
import type { InviteRepo } from "./services/InviteRepo.server"
import type { EventBroker } from "./services/EventBroker.server"

type AppServices =
  | LldapClient
  | VaultPki
  | GitHubClient
  | EmailService
  | InviteRepo
  | EventBroker
  | WorkflowEngine.WorkflowEngine

const appRuntime = ManagedRuntime.make(AppLayer)

export function runEffect<A, E>(
  effect: Effect.Effect<A, E, AppServices>,
): Promise<A> {
  return appRuntime.runPromise(effect) as Promise<A>
}
