import { runEffect } from "~/lib/runtime.server"
import { config } from "~/lib/config.server"
import { handleAdminUsersMutation, parseAdminUsersMutation } from "~/lib/mutations/admin-users"

export async function POST(request: Request) {
  const origin = request.headers.get("Origin")
  if (origin && !origin.endsWith(config.allowedOriginSuffix)) {
    return new Response("Invalid origin", { status: 403 })
  }

  const formData = await request.formData()
  const parsed = parseAdminUsersMutation(formData as any)
  if ("error" in parsed) return Response.json(parsed, { status: 400 })

  const result = await runEffect(handleAdminUsersMutation(parsed))
  return Response.json(result)
}
