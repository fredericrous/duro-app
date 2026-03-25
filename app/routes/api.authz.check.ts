import { Effect } from "effect"
import type { Route } from "./+types/api.authz.check"
import { requireApiAuth, requireScope } from "~/lib/api-auth.server"
import { AuthzEngine } from "~/lib/governance/AuthzEngine.server"
import { runEffect } from "~/lib/runtime.server"

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 })
  }

  try {
    const auth = await requireApiAuth(request)
    requireScope(auth, "authz:check")

    const { subject, application, action, resourceId } = await request.json()
    if (!subject || !application || !action) {
      return Response.json({ error: "Missing required fields: subject, application, action" }, { status: 400 })
    }

    const decision = await runEffect(
      Effect.gen(function* () {
        const engine = yield* AuthzEngine
        return yield* engine.checkAccess({ subject, application, action, resourceId })
      }),
    )

    return Response.json(decision)
  } catch (err) {
    if (err instanceof Response) throw err
    return Response.json({ error: `Authorization check failed: ${err}` }, { status: 500 })
  }
}
