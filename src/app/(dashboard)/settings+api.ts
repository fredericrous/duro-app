import { runEffect } from "~/lib/runtime.server"
import { requireAuth } from "~/lib/auth.server"
import { handleSettingsMutation, parseSettingsMutation } from "~/lib/mutations/settings"

export async function POST(request: Request) {
  const auth = await requireAuth(request)
  const formData = await request.formData()
  const parsed = parseSettingsMutation(formData as any, auth)
  if ("error" in parsed) return Response.json(parsed, { status: 400 })

  const result = await runEffect(handleSettingsMutation(parsed))
  if (result && typeof result === "object" && "_redirect" in result) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: (result as any)._redirect,
        "Set-Cookie": (result as any)._cookie,
      },
    })
  }
  return Response.json(result)
}
