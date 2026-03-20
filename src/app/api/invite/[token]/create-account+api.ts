import { isOriginAllowed } from "~/lib/config.server"
import { runEffect } from "~/lib/runtime.server"
import { handleCreateAccount, parseCreateAccountMutation } from "~/lib/mutations/create-account"

export async function POST(request: Request, params: Record<string, string>) {
  const token = params.token
  if (!token) {
    return Response.json({ error: "Missing invite token" }, { status: 400 })
  }

  if (!isOriginAllowed(request.headers.get("Origin"))) {
    return Response.json({ error: "Invalid request origin" }, { status: 403 })
  }

  const formData = await request.formData()
  const parsed = parseCreateAccountMutation(formData as any, token)
  if ("error" in parsed) return Response.json(parsed, { status: 400 })

  const result = await runEffect(handleCreateAccount(parsed))
  if ("_redirect" in result) {
    return new Response(null, {
      status: 302,
      headers: { Location: result._redirect },
    })
  }
  return Response.json(result)
}
