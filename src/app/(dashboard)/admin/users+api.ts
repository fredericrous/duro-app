import { Effect } from "effect"
import { runEffect } from "~/lib/runtime.server"
import { requireAuth } from "~/lib/auth.server"
import { config, isOriginAllowed } from "~/lib/config.server"
import { UserManager } from "~/lib/services/UserManager.server"
import { InviteRepo } from "~/lib/services/InviteRepo.server"
import { CertificateRepo } from "~/lib/services/CertificateRepo.server"
import { handleAdminUsersMutation, parseAdminUsersMutation } from "~/lib/mutations/admin-users"

export async function GET(request: Request) {
  const auth = await requireAuth(request)

  const [users, revocations, certsByUser] = await Promise.all([
    runEffect(
      Effect.gen(function* () {
        const um = yield* UserManager
        return yield* um.getUsers
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        return yield* repo.findRevocations()
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        const um = yield* UserManager
        const certRepo = yield* CertificateRepo
        const allUsers = yield* um.getUsers
        const usernames = allUsers.map((u: { id: string }) => u.id)
        return yield* certRepo.listAllByUsernames(usernames).pipe(Effect.catchAll(() => Effect.succeed({})))
      }),
    ),
  ])

  const systemUserIds = [...new Set(users.filter((u: any) => config.isSystemUser(u.id)).map((u: any) => u.id))]
  return Response.json({
    user: auth.user ?? "",
    isAdmin: auth.groups.includes(config.adminGroupName),
    users,
    revocations,
    systemUserIds,
    certsByUser,
  })
}

export async function POST(request: Request) {
  if (!isOriginAllowed(request.headers.get("Origin"))) {
    return new Response("Invalid origin", { status: 403 })
  }

  const formData = await request.formData()
  const parsed = parseAdminUsersMutation(formData as any)
  if ("error" in parsed) return Response.json(parsed, { status: 400 })

  const result = await runEffect(handleAdminUsersMutation(parsed))
  return Response.json(result)
}
