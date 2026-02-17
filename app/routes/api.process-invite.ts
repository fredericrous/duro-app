import type { Route } from "./+types/api.process-invite"
import { Effect } from "effect"
import { runEffect } from "~/lib/runtime.server"
import { InviteWorkflow } from "~/lib/workflows/invite.server"

export async function action({ request }: Route.ActionArgs) {
  const body = await request.json()

  // Knative delivers CloudEvents in binary mode: attributes in headers, data in body.
  // Fall back to structured mode (full envelope in body) for direct calls.
  const ceType = request.headers.get("ce-type") ?? body.type
  const data = request.headers.has("ce-type") ? body : body.data

  if (ceType !== "duro.invite.requested") {
    return new Response("Unknown event type", { status: 400 })
  }

  try {
    await runEffect(
      InviteWorkflow.execute(data).pipe(
        Effect.withSpan("processInviteEvent", {
          attributes: {
            "cloudevents.type": ceType,
            "invite.id": data?.inviteId,
            "invite.email": data?.email,
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
