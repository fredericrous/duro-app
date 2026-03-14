/**
 * Spike: mutation API endpoint.
 * Accepts POST with intent: "increment" | "decrement" | "reset"
 * Returns the new counter value.
 * Stores state in-memory (sufficient for spike validation).
 */
let counter = 0

export async function POST(request: Request) {
  const formData = await request.formData()
  const intent = (formData as any).get("intent") as string

  switch (intent) {
    case "increment":
      counter++
      break
    case "decrement":
      counter--
      break
    case "reset":
      counter = 0
      break
    default:
      return Response.json({ error: "Unknown intent" }, { status: 400 })
  }

  // Simulate async work
  await new Promise((r) => setTimeout(r, 100))

  return Response.json({ success: true, counter })
}

export async function GET() {
  return Response.json({ counter })
}
