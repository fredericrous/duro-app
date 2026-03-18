import { requireAuth } from "~/lib/auth.server"
import { config } from "~/lib/config.server"

export async function GET(request: Request) {
  const auth = await requireAuth(request)
  return Response.json({
    user: auth.user ?? "",
    isAdmin: auth.groups.includes(config.adminGroupName),
  })
}
