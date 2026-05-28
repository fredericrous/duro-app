#!/usr/bin/env node
/**
 * Duro MCP server — exposes admin operations to Claude CLI via stdio.
 *
 * Wires Claude → `duro_list_groups` / `duro_invite_user` → HTTPS calls to
 * https://join.daddyshome.fr/api/admin/* (skip-mtls HTTPRoute, Bearer-key auth).
 *
 * Required env:
 *   DURO_BASE_URL   e.g. https://join.daddyshome.fr
 *   DURO_API_KEY    a `duro_…` key minted via scripts/mint-api-key.ts
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

const baseUrl = process.env.DURO_BASE_URL
const apiKey = process.env.DURO_API_KEY
if (!baseUrl || !apiKey) {
  console.error("Missing DURO_BASE_URL or DURO_API_KEY env var")
  process.exit(1)
}

async function duroFetch(path, init = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = { raw: text }
  }
  return { ok: res.ok, status: res.status, body: parsed }
}

const server = new McpServer({ name: "duro", version: "0.1.0" })

server.registerTool(
  "duro_list_groups",
  {
    title: "List LLDAP groups",
    description:
      "Returns the list of LLDAP groups (id + name) available for inviting new users. Call this before duro_invite_user to resolve a group name to its id.",
    inputSchema: {},
  },
  async () => {
    const r = await duroFetch("/api/admin/groups", { method: "GET" })
    return {
      content: [{ type: "text", text: JSON.stringify(r.body, null, 2) }],
      isError: !r.ok,
    }
  },
)

server.registerTool(
  "duro_invite_user",
  {
    title: "Invite a new user to duro",
    description:
      "Creates a duro invite for a new user: issues a Vault PKI client cert, emails the invitee a P12 + invite link. The invitee finishes onboarding themselves by setting a password at /invite.",
    inputSchema: {
      email: z.string().email().describe("Invitee email address"),
      groups: z
        .array(
          z.object({
            id: z.number().int().describe("LLDAP group id (from duro_list_groups)"),
            name: z.string().describe("LLDAP group name (from duro_list_groups)"),
          }),
        )
        .min(1)
        .describe("Groups the invitee will be added to. At least one."),
      locale: z.enum(["en", "fr"]).optional().describe("Locale for the invite email. Defaults to en."),
    },
  },
  async (args) => {
    const r = await duroFetch("/api/admin/invites", {
      method: "POST",
      body: JSON.stringify(args),
    })
    return {
      content: [{ type: "text", text: JSON.stringify(r.body, null, 2) }],
      isError: !r.ok,
    }
  },
)

await server.connect(new StdioServerTransport())
