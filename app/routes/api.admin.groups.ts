import { Effect } from "effect"
import type { Route } from "./+types/api.admin.groups"
import { requireApiAuth, requireScope } from "~/lib/api-auth.server"
import { UserManager } from "~/lib/services/UserManager.server"
import { runEffect } from "~/lib/runtime.server"

export async function loader({ request }: Route.LoaderArgs) {
  try {
    const auth = await requireApiAuth(request)
    requireScope(auth, "invites:create")

    const groups = await runEffect(
      Effect.gen(function* () {
        const um = yield* UserManager
        return yield* um.getGroups
      }),
    )

    return Response.json({
      groups: groups.map((g) => ({ id: g.id, name: g.displayName })),
    })
  } catch (err) {
    if (err instanceof Response) throw err
    return Response.json({ error: `Failed to list groups: ${err}` }, { status: 500 })
  }
}
