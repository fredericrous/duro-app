import { Effect } from "effect"
import type { Route } from "./+types/api.invitations"
import { requireApiAuth, requireScope } from "~/lib/api-auth.server"
import { AccessInvitationRepo } from "~/lib/governance/AccessInvitationRepo.server"
import { runEffect } from "~/lib/runtime.server"

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 })
  }

  try {
    const auth = await requireApiAuth(request)
    requireScope(auth, "invitations:create")

    const { applicationId, roleId, entitlementId, invitedPrincipalId, message } = await request.json()
    if (!applicationId || !invitedPrincipalId) {
      return Response.json({ error: "Missing required fields: applicationId, invitedPrincipalId" }, { status: 400 })
    }

    const invitation = await runEffect(
      Effect.gen(function* () {
        const repo = yield* AccessInvitationRepo
        return yield* repo.create({
          applicationId,
          roleId,
          entitlementId,
          invitedPrincipalId,
          invitedBy: auth.principalId,
          message,
        })
      }),
    )

    return Response.json(invitation)
  } catch (err) {
    if (err instanceof Response) throw err
    return Response.json({ error: `Invitation creation failed: ${err}` }, { status: 500 })
  }
}
