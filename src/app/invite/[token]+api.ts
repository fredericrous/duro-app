export async function POST(request: Request) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { isOriginAllowed } = require("~/lib/config.server")
  if (!isOriginAllowed(request.headers.get("Origin"))) {
    return Response.json({ error: "Invalid request origin" }, { status: 403 })
  }

  const formData = await request.formData()
  const intent = (formData as any).get("intent") as string | null

  if (intent === "reveal") {
    return Response.json({ revealed: true })
  }

  return Response.json({ error: "Unknown action" }, { status: 400 })
}
