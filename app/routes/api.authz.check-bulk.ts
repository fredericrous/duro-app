import { Effect } from "effect"
import type { Route } from "./+types/api.authz.check-bulk"
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

    const { checks } = await request.json()
    if (!Array.isArray(checks) || checks.length === 0) {
      return Response.json({ error: "Missing required field: checks (non-empty array)" }, { status: 400 })
    }

    for (const check of checks) {
      if (!check.subject || !check.application || !check.action) {
        return Response.json({ error: "Each check must include subject, application, and action" }, { status: 400 })
      }
    }

    const results = await runEffect(
      Effect.gen(function* () {
        const engine = yield* AuthzEngine
        return yield* engine.checkBulk(checks)
      }),
    )

    return Response.json({ results })
  } catch (err) {
    if (err instanceof Response) throw err
    return Response.json({ error: `Bulk authorization check failed: ${err}` }, { status: 500 })
  }
}
