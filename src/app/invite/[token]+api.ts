import { config } from "~/lib/config.server"

export async function POST(request: Request) {
  const origin = request.headers.get("Origin")
  if (origin && !origin.endsWith(config.allowedOriginSuffix)) {
    return Response.json({ error: "Invalid request origin" }, { status: 403 })
  }

  const formData = await request.formData()
  const intent = (formData as any).get("intent") as string | null

  if (intent === "reveal") {
    return Response.json({ revealed: true })
  }

  return Response.json({ error: "Unknown action" }, { status: 400 })
}
