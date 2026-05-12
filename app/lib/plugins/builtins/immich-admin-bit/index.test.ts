import { describe, expect, it, vi } from "vitest"
import { Effect } from "effect"
import { immichAdminBitPlugin } from "./index"
import type { GrantContext, PluginServices } from "../../contracts"
import { PluginError } from "../../errors"

const immichConfig = { immichUrl: "https://immich.example.com" }

const baseCtx = (overrides: Partial<GrantContext> = {}): GrantContext =>
  ({
    grant: { id: "g-1" },
    role: { slug: "admin" },
    principal: { id: "p-alice", externalId: "alice", email: "alice@example.com" },
    applicationId: "app-immich",
    applicationSlug: "immich",
    config: immichConfig,
    ...overrides,
  }) as unknown as GrantContext

// Typed noop stubs for the PluginServices the immich plugin doesn't touch.
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
  getImpl: (url: string) => Effect.Effect<unknown, PluginError> = () => Effect.succeed([]),
  putImpl: (url: string, body: unknown) => Effect.Effect<unknown, PluginError> = () => Effect.succeed({}),
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
      put: (url: string, body: unknown) => {
        calls.push({ method: "PUT", url, body })
        return putImpl(url, body)
      },
      post: () => Effect.succeed({}),
      del: () => Effect.void,
    },
  }
  return { services, calls }
}

describe("immich-admin-bit plugin — provision", () => {
  it("PUTs isAdmin:true when the user exists and isn't already admin", async () => {
    const { services, calls } = mkServices(() =>
      Effect.succeed([{ id: "u-1", email: "alice@example.com", isAdmin: false }]),
    )
    await Effect.runPromise(immichAdminBitPlugin.provision!(baseCtx(), services))

    const put = calls.find((c) => c.method === "PUT")!
    expect(put.url).toBe("https://immich.example.com/api/users/u-1")
    expect(put.body).toEqual({ isAdmin: true })
  })

  it("is a no-op for non-admin roles", async () => {
    const { services, calls } = mkServices()
    await Effect.runPromise(immichAdminBitPlugin.provision!(baseCtx({ role: { slug: "viewer" } as never }), services))
    expect(calls).toEqual([]) // no GET, no PUT
  })

  it("is a no-op when the user is already admin", async () => {
    const { services, calls } = mkServices(() =>
      Effect.succeed([{ id: "u-1", email: "alice@example.com", isAdmin: true }]),
    )
    await Effect.runPromise(immichAdminBitPlugin.provision!(baseCtx(), services))
    // GET happens, but no PUT.
    expect(calls.find((c) => c.method === "PUT")).toBeUndefined()
  })

  it("fails when the user isn't in Immich yet (must OIDC-login first)", async () => {
    const { services } = mkServices(() => Effect.succeed([]))
    const exit = await Effect.runPromiseExit(immichAdminBitPlugin.provision!(baseCtx(), services))
    expect(exit._tag).toBe("Failure")
  })

  it("fails when the principal has no email", async () => {
    const { services } = mkServices()
    const exit = await Effect.runPromiseExit(
      immichAdminBitPlugin.provision!(baseCtx({ principal: { id: "p-1", email: null } as never }), services),
    )
    expect(exit._tag).toBe("Failure")
  })
})

describe("immich-admin-bit plugin — deprovision", () => {
  it("PUTs isAdmin:false when the user is currently admin", async () => {
    const { services, calls } = mkServices(() =>
      Effect.succeed([{ id: "u-1", email: "alice@example.com", isAdmin: true }]),
    )
    await Effect.runPromise(immichAdminBitPlugin.deprovision!(baseCtx(), services))

    const put = calls.find((c) => c.method === "PUT")!
    expect(put.body).toEqual({ isAdmin: false })
  })

  it("is a no-op when the user isn't currently admin", async () => {
    const { services, calls } = mkServices(() =>
      Effect.succeed([{ id: "u-1", email: "alice@example.com", isAdmin: false }]),
    )
    await Effect.runPromise(immichAdminBitPlugin.deprovision!(baseCtx(), services))
    expect(calls.find((c) => c.method === "PUT")).toBeUndefined()
  })

  it("is a no-op when the user isn't in Immich at all", async () => {
    const { services, calls } = mkServices(() => Effect.succeed([]))
    await Effect.runPromise(immichAdminBitPlugin.deprovision!(baseCtx(), services))
    expect(calls.find((c) => c.method === "PUT")).toBeUndefined()
  })

  it("is a no-op for non-admin roles", async () => {
    const { services, calls } = mkServices()
    await Effect.runPromise(immichAdminBitPlugin.deprovision!(baseCtx({ role: { slug: "viewer" } as never }), services))
    expect(calls).toEqual([])
  })
})

describe("immich-admin-bit plugin — manifest", () => {
  it("declares immich-admin-bit slug + immich allowedDomain", () => {
    expect(immichAdminBitPlugin.manifest.slug).toBe("immich-admin-bit")
    expect(immichAdminBitPlugin.manifest.allowedDomains).toContain("photos.daddyshome.fr")
  })
})
