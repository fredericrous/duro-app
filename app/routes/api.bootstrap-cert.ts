import { Effect } from "effect"
import * as fs from "node:fs/promises"
import type { Route } from "./+types/api.bootstrap-cert"
import { CertManager } from "~/lib/services/CertManager.server"
import { EmailService } from "~/lib/services/EmailService.server"
import { runEffect } from "~/lib/runtime.server"

const VAULT_ADDR = process.env.VAULT_ADDR ?? ""

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 })
  }

  if (!VAULT_ADDR) {
    return Response.json({ error: "VAULT_ADDR not configured" }, { status: 500 })
  }

  const { token, username, email } = await request.json()
  if (!token || !username || !email) {
    return Response.json({ error: "Missing required fields: token, username, email" }, { status: 400 })
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

  // 3. Issue cert + email via existing Effect services
  try {
    const result = await runEffect(
      Effect.gen(function* () {
        const certMgr = yield* CertManager
        const emailSvc = yield* EmailService

        const certId = `bootstrap-${username}`
        const { p12Buffer, password } = yield* certMgr.issueCertAndP12(email, certId)
        yield* emailSvc.sendCertRenewalEmail(email, p12Buffer)

        // Clean up the temp P12 secret from NAS Vault after sending
        yield* certMgr
          .deleteP12Secret(certId)
          .pipe(
            Effect.catchAll((e) =>
              Effect.logWarning("bootstrap-cert: failed to clean up temp secret", { error: String(e) }),
            ),
          )

        return { p12Buffer, password }
      }),
    )

    return Response.json({
      success: true,
      p12: result.p12Buffer.toString("base64"),
      password: result.password,
    })
  } catch (err) {
    return Response.json({ error: `Certificate issuance failed: ${err}` }, { status: 500 })
  }
}
