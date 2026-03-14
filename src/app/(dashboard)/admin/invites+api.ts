import { runEffect } from "~/lib/runtime.server"
import { config } from "~/lib/config.server"
import { handleAdminInvitesMutation, parseAdminInvitesMutation } from "~/lib/mutations/admin-invites"

export async function POST(request: Request) {
  const origin = request.headers.get("Origin")
  if (origin && !origin.endsWith(config.allowedOriginSuffix)) {
    return new Response("Invalid origin", { status: 403 })
  }

  const formData = await request.formData()
  const parsed = parseAdminInvitesMutation(formData as any)
  if ("error" in parsed) return Response.json(parsed, { status: 400 })

  const result = await runEffect(handleAdminInvitesMutation(parsed))
  return Response.json(result)
}
