import { redirect } from "react-router"
import type { Route } from "./+types/health"
import { config } from "~/lib/config.server"

export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const returnTo = url.searchParams.get("return")

  if (returnTo && returnTo.startsWith(config.inviteBaseUrl)) {
    throw redirect(returnTo)
  }

  return Response.json({ status: "ok" }, { headers: { "Access-Control-Allow-Origin": config.inviteBaseUrl } })
}
