// @vitest-environment node
import { describe, expect, it, vi } from "vitest"
import { Effect } from "effect"
import { giteaTeamsPlugin } from "./index"
import type { GrantContext, PluginServices } from "../../contracts"
import { PluginError } from "../../errors"
import { mkRole, mkPrincipal, mkGrant } from "~/test/factories"

const giteaConfig = {
  giteaUrl: "https://gitea.example.com",
  orgName: "homelab",
  viewerTeamName: "viewers",
  editorTeamName: "editors",
  adminTeamName: "Owners",
}

const baseCtx = (overrides: Partial<GrantContext> = {}): GrantContext => ({
  grant: mkGrant({ id: "g-1" }),
  role: mkRole({ id: "role-1", slug: "viewer", applicationId: "app-gitea" }),
  principal: mkPrincipal({ id: "p-alice", externalId: "alice", displayName: "Alice" }),
  applicationId: "app-gitea",
  applicationSlug: "gitea",
  config: giteaConfig,
  ...overrides,
})

const mkLog = () => vi.fn(() => Effect.void as Effect.Effect<void>)

// Typed noop stubs for the PluginServices fields gitea-teams doesn't touch.
// Each method returns Effect.die("...") so a surprise call from a future
// plugin-host change fails loudly with the call site.
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

/** Build a PluginServices stub recording the calls made through `http`. */
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

describe("gitea-teams plugin — provision", () => {
  it("PUTs to the right team members endpoint when the role is `viewer`", async () => {
    const { services, calls } = mkServices({
      get: () => Effect.succeed([{ id: 7, name: "viewers", permission: "read" }]),
    })
    await Effect.runPromise(giteaTeamsPlugin.provision!(baseCtx(), services))

    expect(calls).toEqual([
      { method: "GET", url: "https://gitea.example.com/api/v1/orgs/homelab/teams" },
      { method: "PUT", url: "https://gitea.example.com/api/v1/teams/7/members/alice", body: {} },
    ])
  })

  it("skips the call when the role has no team mapping (logs + returns)", async () => {
    const { services, calls, log } = mkServices()
    await Effect.runPromise(giteaTeamsPlugin.provision!(baseCtx({ role: mkRole({ slug: "unknown" }) }), services))

    expect(calls).toEqual([])
    expect(log).toHaveBeenCalled()
  })

  it("fails with PluginError when the principal has no externalId", async () => {
    const { services } = mkServices()
    const exit = await Effect.runPromiseExit(
      giteaTeamsPlugin.provision!(baseCtx({ principal: mkPrincipal({ id: "p-1", externalId: null }) }), services),
    )
    expect(exit._tag).toBe("Failure")
  })

  it("fails with PluginError when the configured team isn't found in the org", async () => {
    const { services } = mkServices({
      // Gitea returns teams, but none match the configured viewerTeamName.
      get: () => Effect.succeed([{ id: 9, name: "different-team", permission: "read" }]),
    })
    const exit = await Effect.runPromiseExit(giteaTeamsPlugin.provision!(baseCtx(), services))
    expect(exit._tag).toBe("Failure")
  })

  it("resolves admin → Owners team for the admin role", async () => {
    const { services, calls } = mkServices({
      get: () => Effect.succeed([{ id: 1, name: "Owners", permission: "owner" }]),
    })
    await Effect.runPromise(giteaTeamsPlugin.provision!(baseCtx({ role: mkRole({ slug: "admin" }) }), services))
    expect(calls.find((c) => c.method === "PUT")?.url).toBe("https://gitea.example.com/api/v1/teams/1/members/alice")
  })
})

describe("gitea-teams plugin — deprovision", () => {
  it("DELETEs from the right team members endpoint when the role is `editor`", async () => {
    const { services, calls } = mkServices({
      get: () => Effect.succeed([{ id: 5, name: "editors", permission: "write" }]),
    })
    await Effect.runPromise(giteaTeamsPlugin.deprovision!(baseCtx({ role: mkRole({ slug: "editor" }) }), services))

    expect(calls).toEqual([
      { method: "GET", url: "https://gitea.example.com/api/v1/orgs/homelab/teams" },
      { method: "DELETE", url: "https://gitea.example.com/api/v1/teams/5/members/alice" },
    ])
  })

  it("is a no-op when the team isn't found (logs, no DELETE)", async () => {
    const { services, calls, log } = mkServices({
      get: () => Effect.succeed([]), // empty teams list
    })
    await Effect.runPromise(giteaTeamsPlugin.deprovision!(baseCtx(), services))

    // GET happens, no DELETE follows.
    expect(calls.map((c) => c.method)).toEqual(["GET"])
    expect(log).toHaveBeenCalled()
  })

  it("is a no-op when the role has no team mapping", async () => {
    const { services, calls } = mkServices()
    await Effect.runPromise(giteaTeamsPlugin.deprovision!(baseCtx({ role: mkRole({ slug: "unmapped" }) }), services))
    expect(calls).toEqual([])
  })

  it("fails with PluginError when the principal has no externalId", async () => {
    const { services } = mkServices()
    const exit = await Effect.runPromiseExit(
      giteaTeamsPlugin.deprovision!(baseCtx({ principal: mkPrincipal({ id: "p-1", externalId: null }) }), services),
    )
    expect(exit._tag).toBe("Failure")
  })
})

describe("gitea-teams plugin — manifest", () => {
  it("declares the right capabilities + allowed domain + vault secret", () => {
    expect(giteaTeamsPlugin.manifest.slug).toBe("gitea-teams")
    expect(giteaTeamsPlugin.manifest.capabilities).toContain("http.call")
    expect(giteaTeamsPlugin.manifest.allowedDomains).toContain("gitea.daddyshome.fr")
    expect(giteaTeamsPlugin.manifest.vaultSecrets).toContain("token")
  })

  it("exposes a provisioningTemplates entry for the `gitea` app slug", () => {
    expect(giteaTeamsPlugin.provisioningTemplates).toHaveLength(1)
    expect(giteaTeamsPlugin.provisioningTemplates![0].appSlug).toBe("gitea")
  })
})
