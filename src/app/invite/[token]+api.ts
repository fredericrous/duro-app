// Inline isOriginAllowed to avoid Metro __d module registry collision.
// See create-account+api.ts for full explanation.
const ALLOWED_SUFFIX = process.env.ALLOWED_ORIGIN_SUFFIX ?? "daddyshome.fr"

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return true
  try {
    return new URL(origin).hostname.endsWith(ALLOWED_SUFFIX)
  } catch {
    return false
  }
}

export async function POST(request: Request) {
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
