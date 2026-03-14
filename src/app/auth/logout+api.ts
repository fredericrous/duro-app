import { clearSessionCookie } from "~/lib/session.server"

export async function POST() {
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": clearSessionCookie(),
    },
  })
}
