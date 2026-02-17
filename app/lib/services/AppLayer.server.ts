import { Layer } from "effect"
import { WorkflowEngine } from "@effect/workflow"
import { LldapClientLive } from "./LldapClient.server"
import { VaultPkiLive } from "./VaultPki.server"
import { GitHubClientLive } from "./GitHubClient.server"
import { EmailServiceLive } from "./EmailService.server"
import { InviteRepoLive } from "./InviteRepo.server"
import { InviteWorkflowLayer } from "~/lib/workflows/invite.server"
import { OtelLayer } from "~/lib/telemetry.server"

// OtelLayer installs the OTLP tracer underneath everything.
// InviteWorkflowLayer registers the workflow with the engine (side-effect).
// provideMerge feeds services+engine output into InviteWorkflowLayer's
// requirements, and merges their output into the result.
export const AppLayer = InviteWorkflowLayer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      LldapClientLive,
      VaultPkiLive,
      GitHubClientLive,
      EmailServiceLive,
      InviteRepoLive,
      WorkflowEngine.layerMemory,
    ),
  ),
  Layer.provide(OtelLayer),
)
