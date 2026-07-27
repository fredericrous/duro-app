import { Effect, Either, Schema } from "effect"
import type { Route } from "./+types/api.authz.check"
import { requireApiAuth, requireScope } from "~/lib/api-auth.server"
import { AuthzEngine } from "~/lib/governance/AuthzEngine.server"
import { AccessCheckSchema } from "~/lib/governance/types"
import { runEffect } from "~/lib/runtime.server"

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 })
  }

  try {
    const auth = await requireApiAuth(request)
    requireScope(auth, "authz:check")

    const parsed = Schema.decodeUnknownEither(AccessCheckSchema)(await request.json())
    if (Either.isLeft(parsed)) {
      return Response.json({ error: "Missing required fields: subject, application, action" }, { status: 400 })
    }

    const decision = await runEffect(
      Effect.gen(function* () {
        const engine = yield* AuthzEngine
        return yield* engine.checkAccess(parsed.right)
      }).pipe(Effect.orDie),
    )

    return Response.json(decision)
  } catch (err) {
    if (err instanceof Response) throw err
    // Log the cause server-side; never echo internals to the client.
    console.error("[api.authz.check] failed:", err)
    return Response.json({ error: "Authorization check failed" }, { status: 500 })
  }
}
