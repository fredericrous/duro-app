import { Effect } from "effect"
import type { Route } from "./+types/api.admin-invites"
import { runEffect } from "~/lib/runtime.server"
import { isOriginAllowed } from "~/lib/config.server"
import { requireAuth } from "~/lib/auth.server"
import { config } from "~/lib/config.server"
import { UserManager } from "~/lib/services/UserManager.server"
import { InviteRepo } from "~/lib/services/InviteRepo.server"
import { handleAdminInvitesMutation, parseAdminInvitesMutation } from "~/lib/mutations/admin-invites"

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)

  const [groups, pendingInvites, failedInvites] = await Promise.all([
    runEffect(
      Effect.gen(function* () {
        const um = yield* UserManager
        return yield* um.getGroups
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        return yield* repo.findPending()
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        return yield* repo.findFailed()
      }),
    ),
  ])

  return Response.json({
    user: auth.user ?? "",
    isAdmin: auth.groups.includes(config.adminGroupName),
    groups,
    pendingInvites,
    failedInvites,
  })
}

export async function action({ request }: Route.ActionArgs) {
  if (!isOriginAllowed(request.headers.get("Origin"))) {
    return new Response("Invalid origin", { status: 403 })
  }

  const formData = await request.formData()
  const parsed = parseAdminInvitesMutation(formData as any)
  if ("error" in parsed) return Response.json(parsed, { status: 400 })

  const result = await runEffect(handleAdminInvitesMutation(parsed))
  return Response.json(result)
}
