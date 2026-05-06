import type { Route } from "./+types/api.bootstrap-invite"
import { runEffect } from "~/lib/runtime.server"
import { submitBootstrapInviteWithCallerToken } from "~/lib/workflows/bootstrap.server"
import { Effect } from "effect"

/**
 * External-facing bootstrap endpoint. Caller (typically Terraform / a CI
 * pipeline) supplies `{token, email}`; we validate the token against Vault
 * and, on success, queue the admin invite. The Vault secret is consumed
 * only after the invite is fully created — failures leave the token in
 * place so the operator can retry.
 *
 * The browser-facing wizard at /admin/setup uses a sibling helper
 * (submitBootstrapInviteAuto) that reads the token from Vault directly.
 */
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 })
  }

  let body: { token?: unknown; email?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const token = typeof body.token === "string" ? body.token : ""
  const email = typeof body.email === "string" ? body.email : ""
  if (!token || !email) {
    return Response.json({ error: "Missing required fields: token, email" }, { status: 400 })
  }

  const result = await runEffect(
    submitBootstrapInviteWithCallerToken({ token, email }).pipe(Effect.either),
  )

  if (result._tag === "Left") {
    const err = result.left
    const status =
      err.code === "no_token" || err.code === "token_mismatch" || err.code === "token_expired" ? 401 : 500
    return Response.json({ error: err.message ?? err.code }, { status })
  }

  return Response.json({ success: true, message: `Invite sent to ${result.right.email}` })
}
