import { config } from "~/lib/config.server"

export function loader() {
  return Response.json({ status: "ok" }, { headers: { "Access-Control-Allow-Origin": config.inviteBaseUrl } })
}
