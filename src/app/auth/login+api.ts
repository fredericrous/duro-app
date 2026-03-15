import { createSessionCookie, type SessionData } from "~/lib/session.server"

/**
 * Spike: simulate OIDC callback by creating a session directly.
 * In production, this would be the real OIDC code exchange.
 * POST /auth/login with JSON { sub, name, email, groups }
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SessionData
    if (!body.sub || !body.name) {
      return Response.json({ error: "Missing sub or name" }, { status: 400 })
    }

    const cookie = await createSessionCookie(body)
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/",
        "Set-Cookie": cookie,
      },
    })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Login failed" }, { status: 500 })
  }
}
