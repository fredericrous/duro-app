import type { Route } from "./+types/api.process-invite"
import { Effect } from "effect"
import { runEffect } from "~/lib/runtime.server"
import { InviteWorkflow } from "~/lib/workflows/invite.server"

export async function action({ request }: Route.ActionArgs) {
  const event = await request.json()

  if (event.type !== "duro.invite.requested") {
    return new Response("Unknown event type", { status: 400 })
  }

  try {
    await runEffect(
      InviteWorkflow.execute(event.data).pipe(
        Effect.withSpan("processInviteEvent", {
          attributes: {
            "cloudevents.type": event.type,
            "invite.id": event.data?.inviteId,
            "invite.email": event.data?.email,
          },
        }),
      ),
    )
    return new Response("OK", { status: 200 })
  } catch (e) {
    console.error("Invite workflow failed:", e)
    return new Response("Processing failed", { status: 500 })
  }
}
