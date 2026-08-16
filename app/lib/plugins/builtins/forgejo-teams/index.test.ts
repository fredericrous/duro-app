// @vitest-environment node
import { describe, expect, it, vi } from "vitest"
import { Effect } from "effect"
import { forgejoTeamsPlugin } from "./index"
import type { GrantContext, PluginServices } from "../../contracts"
import { PluginError } from "../../errors"
import { mkRole, mkPrincipal, mkGrant } from "~/test/factories"

const forgejoConfig = {
  forgejoUrl: "https://git.example.com",
  orgName: "fredericrous",
  viewerTeamName: "viewers",
  editorTeamName: "editors",
  adminTeamName: "Owners",
}

const baseCtx = (overrides: Partial<GrantContext> = {}): GrantContext => ({
  grant: mkGrant({ id: "g-1" }),
  role: mkRole({ id: "role-1", slug: "viewer", applicationId: "app-forgejo" }),
  // externalId is DELIBERATELY an opaque sub-style value: the plugin must use
  // displayName (= preferred_username = the forge username), never externalId.
  principal: mkPrincipal({ id: "p-alice", externalId: "8f2c1a-uuid-sub", displayName: "alice" }),
  applicationId: "app-forgejo",
  applicationSlug: "forgejo",
  config: forgejoConfig,
  ...overrides,
})

const mkLog = () => vi.fn(() => Effect.void as Effect.Effect<void>)

const noopLldap: PluginServices["lldap"] = {
  addUserToGroup: () => Effect.die("ScopedLldapClient.addUserToGroup not stubbed"),
  removeUserFromGroup: () => Effect.die("ScopedLldapClient.removeUserFromGroup not stubbed"),
  findGroupByName: () => Effect.die("ScopedLldapClient.findGroupByName not stubbed"),
}
const noopVault: PluginServices["vault"] = {
  readSecret: () => Effect.die("ScopedVaultClient.readSecret not stubbed"),
}
const noopAudit: PluginServices["audit"] = {
  emit: () => Effect.void,
}

const mkServices = (
  httpImpl: {
    get?: (url: string) => Effect.Effect<unknown, PluginError>
    put?: (url: string, body: unknown) => Effect.Effect<unknown, PluginError>
    del?: (url: string) => Effect.Effect<void, PluginError>
  } = {},
): {
  services: PluginServices
  calls: Array<{ method: string; url: string; body?: unknown }>
  log: ReturnType<typeof mkLog>
} => {
  const calls: Array<{ method: string; url: string; body?: unknown }> = []
  const log = mkLog()
  const services: PluginServices = {
    lldap: noopLldap,
    vault: noopVault,
    audit: noopAudit,
    log,
    http: {
      get: (url: string) => {
        calls.push({ method: "GET", url })
        return httpImpl.get ? httpImpl.get(url) : Effect.succeed([])
      },
      post: () => Effect.die("ScopedHttpClient.post not stubbed"),
      put: (url: string, body: unknown) => {
        calls.push({ method: "PUT", url, body })
        return httpImpl.put ? httpImpl.put(url, body) : Effect.succeed({})
      },
      del: (url: string) => {
        calls.push({ method: "DELETE", url })
        return httpImpl.del ? httpImpl.del(url) : Effect.void
      },
    },
  }
  return { services, calls, log }
}

describe("forgejo-teams plugin — provision", () => {
  it("PUTs the DISPLAY NAME (never externalId) to the team members endpoint", async () => {
    const { services, calls } = mkServices({
      get: () => Effect.succeed([{ id: 7, name: "viewers", permission: "read" }]),
    })
    await Effect.runPromise(forgejoTeamsPlugin.provision!(baseCtx(), services))

    expect(calls).toEqual([
      { method: "GET", url: "https://git.example.com/api/v1/orgs/fredericrous/teams" },
      { method: "PUT", url: "https://git.example.com/api/v1/teams/7/members/alice", body: {} },
    ])
    // the sub-style externalId must never appear in any URL
    expect(calls.some((c) => c.url.includes("8f2c1a"))).toBe(false)
  })

  it("skips when the role has no team mapping", async () => {
    const { services, calls, log } = mkServices()
    await Effect.runPromise(forgejoTeamsPlugin.provision!(baseCtx({ role: mkRole({ slug: "unknown" }) }), services))
    expect(calls).toEqual([])
    expect(log).toHaveBeenCalled()
  })

  it("fails with PluginError when the principal has no displayName", async () => {
    const { services } = mkServices()
    const exit = await Effect.runPromiseExit(
      forgejoTeamsPlugin.provision!(
        baseCtx({ principal: mkPrincipal({ id: "p-1", externalId: "sub", displayName: "" }) }),
        services,
      ),
    )
    expect(exit._tag).toBe("Failure")
  })

  it("fails with PluginError when the configured team is missing from the org", async () => {
    const { services } = mkServices({
      get: () => Effect.succeed([{ id: 9, name: "different-team", permission: "read" }]),
    })
    const exit = await Effect.runPromiseExit(forgejoTeamsPlugin.provision!(baseCtx(), services))
    expect(exit._tag).toBe("Failure")
  })

  it("is retry-safe: a second PUT for an existing member is still a success", async () => {
    const { services } = mkServices({
      get: () => Effect.succeed([{ id: 7, name: "viewers", permission: "read" }]),
      put: () => Effect.succeed({}), // Forgejo's PUT is idempotent — 204 either way
    })
    await Effect.runPromise(forgejoTeamsPlugin.provision!(baseCtx(), services))
    await Effect.runPromise(forgejoTeamsPlugin.provision!(baseCtx(), services))
  })
})

describe("forgejo-teams plugin — deprovision", () => {
  it("DELETEs the display-name member from the resolved team", async () => {
    const { services, calls } = mkServices({
      get: () => Effect.succeed([{ id: 5, name: "editors", permission: "write" }]),
    })
    await Effect.runPromise(forgejoTeamsPlugin.deprovision!(baseCtx({ role: mkRole({ slug: "editor" }) }), services))
    expect(calls).toEqual([
      { method: "GET", url: "https://git.example.com/api/v1/orgs/fredericrous/teams" },
      { method: "DELETE", url: "https://git.example.com/api/v1/teams/5/members/alice" },
    ])
  })

  it("member already absent (HTTP 404) → idempotent success, logged", async () => {
    const { services, log } = mkServices({
      get: () => Effect.succeed([{ id: 5, name: "viewers", permission: "read" }]),
      del: () => Effect.fail(new PluginError({ message: "HTTP 404 from https://git.example.com/..." })),
    })
    await Effect.runPromise(forgejoTeamsPlugin.deprovision!(baseCtx(), services))
    expect(log).toHaveBeenCalled()
  })

  it("other DELETE failures still fail the job (so the worker retries)", async () => {
    const { services } = mkServices({
      get: () => Effect.succeed([{ id: 5, name: "viewers", permission: "read" }]),
      del: () => Effect.fail(new PluginError({ message: "HTTP 503 from https://git.example.com/..." })),
    })
    const exit = await Effect.runPromiseExit(forgejoTeamsPlugin.deprovision!(baseCtx(), services))
    expect(exit._tag).toBe("Failure")
  })

  it("team gone → no-op with a log, never an error", async () => {
    const { services, calls, log } = mkServices({ get: () => Effect.succeed([]) })
    await Effect.runPromise(forgejoTeamsPlugin.deprovision!(baseCtx(), services))
    expect(calls.map((c) => c.method)).toEqual(["GET"])
    expect(log).toHaveBeenCalled()
  })
})

describe("forgejo-teams plugin — manifest", () => {
  it("declares capabilities, the public forge host, and the vault token", () => {
    expect(forgejoTeamsPlugin.manifest.slug).toBe("forgejo-teams")
    expect(forgejoTeamsPlugin.manifest.capabilities).toContain("http.call")
    expect(forgejoTeamsPlugin.manifest.allowedDomains).toContain("git.daddyshome.fr")
    expect(forgejoTeamsPlugin.manifest.vaultSecrets).toContain("token")
  })

  it("templates the `forgejo` app with org fredericrous (NOT gitea's homelab)", () => {
    expect(forgejoTeamsPlugin.provisioningTemplates).toHaveLength(1)
    const tpl = forgejoTeamsPlugin.provisioningTemplates![0]
    expect(tpl.appSlug).toBe("forgejo")
    expect((tpl.config as { orgName: string }).orgName).toBe("fredericrous")
  })
})
