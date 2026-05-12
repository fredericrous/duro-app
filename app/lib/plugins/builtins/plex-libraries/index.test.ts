import { describe, expect, it, vi } from "vitest"
import { Effect } from "effect"
import { plexLibrariesPlugin } from "./index"
import type { GrantContext, PluginServices } from "../../contracts"
import { PluginError } from "../../errors"

const plexConfig = { plexUrl: "https://plex.example.com" }

const baseCtx = (overrides: Partial<GrantContext> = {}): GrantContext =>
  ({
    grant: { id: "g-1" },
    role: { slug: "viewer" },
    principal: { id: "p-alice", externalId: "alice", email: "alice@example.com" },
    applicationId: "app-plex",
    applicationSlug: "plex",
    config: plexConfig,
    ...overrides,
  }) as unknown as GrantContext

// Typed noop stubs for the PluginServices the plex plugin doesn't touch.
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
  getImpl: (url: string) => Effect.Effect<unknown, PluginError> = () => Effect.succeed({}),
  postImpl: (url: string, body: unknown) => Effect.Effect<unknown, PluginError> = () => Effect.succeed({}),
  delImpl: (url: string) => Effect.Effect<void, PluginError> = () => Effect.void,
): { services: PluginServices; calls: Array<{ method: string; url: string; body?: unknown }> } => {
  const calls: Array<{ method: string; url: string; body?: unknown }> = []
  const services: PluginServices = {
    lldap: noopLldap,
    vault: noopVault,
    audit: noopAudit,
    log: () => Effect.void,
    http: {
      get: (url: string) => {
        calls.push({ method: "GET", url })
        return getImpl(url)
      },
      post: (url: string, body: unknown) => {
        calls.push({ method: "POST", url, body })
        return postImpl(url, body)
      },
      put: () => Effect.succeed({}),
      del: (url: string) => {
        calls.push({ method: "DELETE", url })
        return delImpl(url)
      },
    },
  }
  return { services, calls }
}

describe("plex-libraries plugin — provision", () => {
  it("invites a fresh user and shares all libraries", async () => {
    // No existing share → fetch identity + sections → POST shared_servers.
    const { services, calls } = mkServices((url) => {
      if (url === "https://plex.tv/api/v2/shared_servers") return Effect.succeed([])
      if (url === "https://plex.example.com/identity")
        return Effect.succeed({ MediaContainer: { machineIdentifier: "machine-xyz" } })
      if (url === "https://plex.example.com/library/sections")
        return Effect.succeed({
          MediaContainer: {
            Directory: [
              { key: "1", title: "Movies", type: "movie" },
              { key: "2", title: "TV", type: "show" },
            ],
          },
        })
      return Effect.succeed({})
    })

    await Effect.runPromise(plexLibrariesPlugin.provision!(baseCtx(), services))

    // 3 GETs + 1 POST.
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET", "GET", "POST"])
    const postCall = calls.find((c) => c.method === "POST")!
    expect(postCall.url).toBe("https://plex.tv/api/v2/shared_servers")
    expect(postCall.body).toMatchObject({
      invitedEmail: "alice@example.com",
      machineIdentifier: "machine-xyz",
      librarySectionIds: [1, 2],
    })
  })

  it("skips the POST when the user already has a share", async () => {
    const { services, calls } = mkServices((url) => {
      if (url === "https://plex.tv/api/v2/shared_servers")
        return Effect.succeed([
          { id: 42, machineIdentifier: "m", invitedEmail: "alice@example.com", username: "alice" },
        ])
      return Effect.succeed({})
    })

    await Effect.runPromise(plexLibrariesPlugin.provision!(baseCtx(), services))

    // Only the lookup happens — no POST.
    expect(calls.find((c) => c.method === "POST")).toBeUndefined()
  })

  it("fails with PluginError when the principal has no email", async () => {
    const { services } = mkServices()
    const exit = await Effect.runPromiseExit(
      plexLibrariesPlugin.provision!(baseCtx({ principal: { id: "p-1", email: null } as never }), services),
    )
    expect(exit._tag).toBe("Failure")
  })

  it("fails when /identity doesn't return a machineIdentifier", async () => {
    const { services } = mkServices((url) => {
      if (url === "https://plex.tv/api/v2/shared_servers") return Effect.succeed([])
      if (url === "https://plex.example.com/identity") return Effect.succeed({ MediaContainer: {} })
      return Effect.succeed({})
    })
    const exit = await Effect.runPromiseExit(plexLibrariesPlugin.provision!(baseCtx(), services))
    expect(exit._tag).toBe("Failure")
  })
})

describe("plex-libraries plugin — deprovision", () => {
  it("DELETEs the share when one is found for the user's email", async () => {
    const { services, calls } = mkServices((url) =>
      url === "https://plex.tv/api/v2/shared_servers"
        ? Effect.succeed([{ id: 99, machineIdentifier: "m", invitedEmail: "alice@example.com", username: "alice" }])
        : Effect.succeed({}),
    )

    await Effect.runPromise(plexLibrariesPlugin.deprovision!(baseCtx(), services))

    const del = calls.find((c) => c.method === "DELETE")!
    expect(del.url).toBe("https://plex.tv/api/v2/shared_servers/99")
  })

  it("is a no-op when no share exists for the user", async () => {
    const { services, calls } = mkServices(() => Effect.succeed([]))
    await Effect.runPromise(plexLibrariesPlugin.deprovision!(baseCtx(), services))
    expect(calls.find((c) => c.method === "DELETE")).toBeUndefined()
  })

  it("fails when the principal has no email", async () => {
    const { services } = mkServices()
    const exit = await Effect.runPromiseExit(
      plexLibrariesPlugin.deprovision!(baseCtx({ principal: { id: "p-1", email: null } as never }), services),
    )
    expect(exit._tag).toBe("Failure")
  })
})

describe("plex-libraries plugin — manifest", () => {
  it("exposes the right slug + capabilities + allowed domains", () => {
    expect(plexLibrariesPlugin.manifest.slug).toBe("plex-libraries")
    expect(plexLibrariesPlugin.manifest.allowedDomains).toContain("plex.daddyshome.fr")
    expect(plexLibrariesPlugin.manifest.allowedDomains).toContain("plex.tv")
  })
})
