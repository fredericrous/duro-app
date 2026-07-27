import { Effect, Either, Schema } from "effect"
import type { Route } from "./+types/api.authz.check-bulk"
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

    const parsed = Schema.decodeUnknownEither(Schema.Struct({ checks: Schema.NonEmptyArray(AccessCheckSchema) }))(
      await request.json(),
    )
    if (Either.isLeft(parsed)) {
      return Response.json(
        { error: "Body must be { checks: [...] } where each check includes subject, application, and action" },
        { status: 400 },
      )
    }

    const results = await runEffect(
      Effect.gen(function* () {
        const engine = yield* AuthzEngine
        return yield* engine.checkBulk(parsed.right.checks)
      }).pipe(Effect.orDie),
    )

    return Response.json({ results })
  } catch (err) {
    if (err instanceof Response) throw err
    // Log the cause server-side; never echo internals to the client.
    console.error("[api.authz.check-bulk] failed:", err)
    return Response.json({ error: "Bulk authorization check failed" }, { status: 500 })
  }
}
