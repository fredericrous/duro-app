import { getSession } from "~/lib/session.server"

const PUBLIC_PREFIXES = ["/health", "/auth/", "/invite/", "/api/invite/", "/api/bootstrap-invite"]
const isDev = process.env.NODE_ENV === "development"

export default async function middleware(request: Request) {
  if (isDev) return

  const url = new URL(request.url)

  // Root and public paths are always allowed
  if (url.pathname === "/" || PUBLIC_PREFIXES.some((p) => url.pathname.startsWith(p))) {
    return
  }

  // All other paths require a session
  const session = await getSession(request)
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }
}
