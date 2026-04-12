import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import { applyPermissionStrategy, reversePermissionStrategy } from "./interpreter"
import type { PluginAction, GrantContext, PluginServices } from "./contracts"

const ctx: GrantContext = {
  grant: { id: "g1", principalId: "p1", roleId: "r1", entitlementId: null, resourceId: null, grantedBy: "admin", reason: null, expiresAt: null, revokedAt: null, revokedBy: null, createdAt: "" },
  role: { id: "r1", applicationId: "app1", slug: "editor", displayName: "Editor", description: null, maxDurationHours: null, createdAt: "" },
  principal: { id: "p1", principalType: "user", externalId: "alice", displayName: "Alice", email: "alice@test.com", enabled: true, createdAt: "", updatedAt: "" },
  applicationId: "app1",
  applicationSlug: "myapp",
  config: { viewerGroup: "myapp-user", editorGroup: "myapp-user", adminGroup: "myapp-admin" },
}

function makeRecordingServices() {
  const calls: Array<{ method: string; args: unknown[] }> = []

  const svc: PluginServices = {
    lldap: {
      addUserToGroup: (userId, groupName) => Effect.sync(() => { calls.push({ method: "addUserToGroup", args: [userId, groupName] }) }),
      removeUserFromGroup: (userId, groupName) => Effect.sync(() => { calls.push({ method: "removeUserFromGroup", args: [userId, groupName] }) }),
      findGroupByName: (groupName) => Effect.succeed({ id: 1, displayName: groupName }),
    },
    http: {
      get: (url, opts) => Effect.sync(() => { calls.push({ method: "http.get", args: [url, opts] }); return {} }),
      post: (url, body, opts) => Effect.sync(() => { calls.push({ method: "http.post", args: [url, body, opts] }); return {} }),
      put: (url, body, opts) => Effect.sync(() => { calls.push({ method: "http.put", args: [url, body, opts] }); return {} }),
      del: (url, opts) => Effect.sync(() => { calls.push({ method: "http.delete", args: [url, opts] }) }),
    },
    vault: {
      readSecret: () => Effect.succeed("fake-secret"),
    },
    audit: {
      emit: () => Effect.void,
    },
    log: () => Effect.void,
  }

  return { svc, calls }
}

describe("applyPermissionStrategy", () => {
  it("dispatches lldap.addGroupMember with resolved templates", async () => {
    const actions: PluginAction[] = [
      { op: "lldap.addGroupMember", group: "${config.editorGroup}", user: "${principal.externalId}", reversible: true },
    ]
    const { svc, calls } = makeRecordingServices()

    await Effect.runPromise(applyPermissionStrategy(actions, ctx, svc))

    expect(calls).toEqual([{ method: "addUserToGroup", args: ["alice", "myapp-user"] }])
  })

  it("dispatches multiple actions in order", async () => {
    const actions: PluginAction[] = [
      { op: "lldap.addGroupMember", group: "${config.viewerGroup}", user: "${principal.externalId}", reversible: true },
      { op: "lldap.addGroupMember", group: "${config.adminGroup}", user: "${principal.externalId}", reversible: true },
    ]
    const { svc, calls } = makeRecordingServices()

    await Effect.runPromise(applyPermissionStrategy(actions, ctx, svc))

    expect(calls).toHaveLength(2)
    expect(calls[0].args[1]).toBe("myapp-user")
    expect(calls[1].args[1]).toBe("myapp-admin")
  })

  it("handles empty action list as a no-op", async () => {
    const { svc, calls } = makeRecordingServices()
    await Effect.runPromise(applyPermissionStrategy([], ctx, svc))
    expect(calls).toHaveLength(0)
  })
})

describe("reversePermissionStrategy", () => {
  it("flips lldap.addGroupMember to removeGroupMember", async () => {
    const actions: PluginAction[] = [
      { op: "lldap.addGroupMember", group: "${config.editorGroup}", user: "${principal.externalId}", reversible: true },
    ]
    const { svc, calls } = makeRecordingServices()

    await Effect.runPromise(reversePermissionStrategy(actions, ctx, svc))

    expect(calls).toEqual([{ method: "removeUserFromGroup", args: ["alice", "myapp-user"] }])
  })

  it("skips non-reversible actions", async () => {
    const actions: PluginAction[] = [
      { op: "lldap.addGroupMember", group: "${config.editorGroup}", user: "${principal.externalId}", reversible: true },
      { op: "http.post", url: "https://example.com", body: {}, reversible: false },
    ]
    const { svc, calls } = makeRecordingServices()

    await Effect.runPromise(reversePermissionStrategy(actions, ctx, svc))

    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe("removeUserFromGroup")
  })
})
