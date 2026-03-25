import type { Route } from "./+types/api.access-requests"
import { requireApiAuth, requireScope } from "~/lib/api-auth.server"
import { submitAccessRequest } from "~/lib/workflows/access-request.server"
import { runEffect } from "~/lib/runtime.server"

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 })
  }

  try {
    const auth = await requireApiAuth(request)
    requireScope(auth, "requests:create")

    const { applicationId, roleId, entitlementId, justification, requestedDurationHours } = await request.json()
    if (!applicationId) {
      return Response.json({ error: "Missing required field: applicationId" }, { status: 400 })
    }

    const result = await runEffect(
      submitAccessRequest({
        requesterId: auth.principalId,
        applicationId,
        roleId,
        entitlementId,
        justification,
        requestedDurationHours,
      }),
    )

    return Response.json(result)
  } catch (err) {
    if (err instanceof Response) throw err
    return Response.json({ error: `Access request failed: ${err}` }, { status: 500 })
  }
}
