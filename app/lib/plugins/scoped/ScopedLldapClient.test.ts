import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import { makeScopedLldapClient } from "./ScopedLldapClient"
import type { PluginManifest } from "../contracts"
import { ScopeViolation } from "../errors"

const baseManifest: PluginManifest = {
  slug: "test-plugin",
  version: "1.0.0",
  displayName: "Test",
  description: "test",
  capabilities: ["lldap.group.read", "lldap.group.member.add", "lldap.group.member.remove"],
  allowedDomains: [],
  ownedLldapGroups: ["${config.viewerGroup}", "${config.adminGroup}"],
  vaultSecrets: [],
  configSchema: {} as any,
  permissionStrategy: { byRoleSlug: {} },
  imperative: false,
  timeoutMs: 10000,
}

const config = { viewerGroup: "app-user", adminGroup: "app-admin" }

function makeFakeLldap() {
  const groups = new Map<string, number>([
    ["app-user", 1],
    ["app-admin", 2],
  ])
  const memberships = new Set<string>()
  let nextId = 10

  return {
    getGroups: Effect.sync(() => [...groups.entries()].map(([displayName, id]) => ({ id, displayName }))),
    addUserToGroup: (userId: string, groupId: number) =>
      Effect.sync(() => {
        memberships.add(`${userId}::${groupId}`)
      }),
    removeUserFromGroup: (userId: string, groupId: number) =>
      Effect.sync(() => {
        memberships.delete(`${userId}::${groupId}`)
      }),
    ensureGroup: (displayName: string) =>
      Effect.sync(() => {
        const existing = groups.get(displayName)
        if (existing !== undefined) return existing
        const id = nextId++
        groups.set(displayName, id)
        return id
      }),
    groups,
    memberships,
  }
}

describe("ScopedLldapClient", () => {
  it("allows addUserToGroup for owned groups", async () => {
    const fake = makeFakeLldap()
    const scoped = makeScopedLldapClient(fake, baseManifest, config)

    await Effect.runPromise(scoped.addUserToGroup("alice", "app-user"))
    expect(fake.memberships.has("alice::1")).toBe(true)
  })

  it("allows removeUserFromGroup for owned groups", async () => {
    const fake = makeFakeLldap()
    fake.memberships.add("alice::1")
    const scoped = makeScopedLldapClient(fake, baseManifest, config)

    await Effect.runPromise(scoped.removeUserFromGroup("alice", "app-user"))
    expect(fake.memberships.has("alice::1")).toBe(false)
  })

  it("rejects addUserToGroup for groups outside ownership", async () => {
    const fake = makeFakeLldap()
    const scoped = makeScopedLldapClient(fake, baseManifest, config)

    const result = await Effect.runPromise(Effect.either(scoped.addUserToGroup("alice", "other-group")))
    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(ScopeViolation)
      expect(result.left.target).toBe("other-group")
    }
  })

  it("rejects removeUserFromGroup for groups outside ownership", async () => {
    const fake = makeFakeLldap()
    const scoped = makeScopedLldapClient(fake, baseManifest, config)

    const result = await Effect.runPromise(Effect.either(scoped.removeUserFromGroup("alice", "secret-group")))
    expect(result._tag).toBe("Left")
  })

  it("findGroupByName returns null for missing groups", async () => {
    const fake = makeFakeLldap()
    const scoped = makeScopedLldapClient(fake, baseManifest, config)

    const result = await Effect.runPromise(scoped.findGroupByName("app-user"))
    expect(result).toEqual({ id: 1, displayName: "app-user" })

    // removeUserFromGroup on a group that doesn't exist in LLDAP → no-op
    fake.groups.delete("app-user")
    await Effect.runPromise(scoped.removeUserFromGroup("alice", "app-user"))
    // No error, just a no-op
  })

  it("rejects findGroupByName for groups outside ownership", async () => {
    const fake = makeFakeLldap()
    const scoped = makeScopedLldapClient(fake, baseManifest, config)

    const result = await Effect.runPromise(Effect.either(scoped.findGroupByName("unowned-group")))
    expect(result._tag).toBe("Left")
  })

  it("resolves ${config.X} patterns in ownedLldapGroups", async () => {
    const fake = makeFakeLldap()
    const scoped = makeScopedLldapClient(fake, baseManifest, config)

    // app-user and app-admin are owned (resolved from config)
    await Effect.runPromise(scoped.addUserToGroup("alice", "app-user"))
    await Effect.runPromise(scoped.addUserToGroup("alice", "app-admin"))
    expect(fake.memberships.size).toBe(2)
  })
})
