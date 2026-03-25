import { Effect } from "effect"
import type { Route } from "./+types/api.principals.$id.grants"
import { requireApiAuth, requireScope } from "~/lib/api-auth.server"
import { GrantRepo } from "~/lib/governance/GrantRepo.server"
import { runEffect } from "~/lib/runtime.server"

export async function loader({ request, params }: Route.LoaderArgs) {
  try {
    const auth = await requireApiAuth(request)
    requireScope(auth, "grants:read")

    const principalId = params.id
    if (!principalId) {
      return Response.json({ error: "Missing principal id" }, { status: 400 })
    }

    const grants = await runEffect(
      Effect.gen(function* () {
        const repo = yield* GrantRepo
        return yield* repo.findActiveForPrincipal(principalId)
      }),
    )

    return Response.json({ grants })
  } catch (err) {
    if (err instanceof Response) throw err
    return Response.json({ error: `Failed to fetch grants: ${err}` }, { status: 500 })
  }
}
