import { Effect } from "effect"
import * as fs from "node:fs/promises"
import { UserManager } from "~/lib/services/UserManager.server"
import { InviteRepo } from "~/lib/services/InviteRepo.server"
import { config } from "~/lib/config.server"
import { queueInvite, revokeInvite } from "~/lib/workflows/invite.server"
import { runEffect } from "~/lib/runtime.server"

const VAULT_ADDR = process.env.VAULT_ADDR ?? ""

export async function POST(request: Request) {
  if (!VAULT_ADDR) {
    return Response.json({ error: "VAULT_ADDR not configured" }, { status: 500 })
  }

  const { token, email } = await request.json()
  if (!token || !email) {
    return Response.json({ error: "Missing required fields: token, email" }, { status: 400 })
  }

  // 1. Authenticate to homelab Vault (Kubernetes SA auth)
  let vaultClientToken: string
  try {
    const saToken = await fs.readFile("/var/run/secrets/kubernetes.io/serviceaccount/token", "utf8")
    const loginResp = await fetch(`${VAULT_ADDR}/v1/auth/kubernetes/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jwt: saToken.trim(), role: "duro" }),
    })
    if (!loginResp.ok) {
      const body = await loginResp.text()
      return Response.json({ error: `Vault login failed: ${body}` }, { status: 500 })
    }
    const loginData = await loginResp.json()
    vaultClientToken = loginData.auth.client_token
  } catch (err) {
    return Response.json({ error: `Vault authentication failed: ${err}` }, { status: 500 })
  }

  // 2. Read + validate bootstrap token (always delete in finally)
  try {
    const secretResp = await fetch(`${VAULT_ADDR}/v1/secret/data/duro/bootstrap-token`, {
      headers: { "X-Vault-Token": vaultClientToken },
    })
    if (!secretResp.ok) {
      return Response.json({ error: "No bootstrap token found" }, { status: 401 })
    }

    const secretData = await secretResp.json()
    const tokenData = secretData.data?.data
    if (!tokenData) {
      return Response.json({ error: "Invalid bootstrap token structure" }, { status: 401 })
    }
    if (tokenData.token !== token) {
      return Response.json({ error: "Invalid token" }, { status: 401 })
    }
    if (Date.now() > Number(tokenData.expires_at)) {
      return Response.json({ error: "Token expired" }, { status: 401 })
    }
  } finally {
    // Always delete token (one-time use, regardless of outcome)
    await fetch(`${VAULT_ADDR}/v1/secret/metadata/duro/bootstrap-token`, {
      method: "DELETE",
      headers: { "X-Vault-Token": vaultClientToken },
    }).catch(() => {})
  }

  // 3. Look up lldap_admin group ID and send invite
  try {
    const result = await runEffect(
      Effect.gen(function* () {
        const userMgr = yield* UserManager
        const inviteRepo = yield* InviteRepo
        const groups = yield* userMgr.getGroups
        const adminGroup = groups.find((g) => g.displayName === config.adminGroupName)
        if (!adminGroup) {
          return yield* Effect.fail(new Error(`Admin group '${config.adminGroupName}' not found in LLDAP`))
        }

        // Revoke any existing pending invite for this email so we can send a fresh one
        const pending = yield* inviteRepo.findPending()
        const existing = pending.find((i) => i.email === email)
        if (existing) {
          yield* Effect.logWarning(`Revoking existing pending invite for ${email} before sending new one`)
          yield* revokeInvite(existing.id)
        }

        return yield* queueInvite({
          email,
          groups: [adminGroup.id],
          groupNames: [config.adminGroupName],
          invitedBy: "bootstrap",
        })
      }),
    )

    return Response.json({ success: true, message: result.message })
  } catch (err) {
    return Response.json({ error: `Invite failed: ${err}` }, { status: 500 })
  }
}
