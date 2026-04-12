import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import { PluginRegistryLive, PluginRegistry } from "./PluginRegistry.server"

describe("PluginRegistry", () => {
  it("loads the lldap-group-membership plugin", async () => {
    const manifests = await Effect.gen(function* () {
      const registry = yield* PluginRegistry
      return yield* registry.list()
    }).pipe(Effect.provide(PluginRegistryLive), Effect.runPromise)

    expect(manifests.length).toBeGreaterThanOrEqual(1)
    const lldap = manifests.find((m) => m.slug === "lldap-group-membership")
    expect(lldap).toBeDefined()
    expect(lldap!.version).toBe("1.0.0")
    expect(lldap!.imperative).toBe(false)
    expect(lldap!.capabilities).toContain("lldap.group.member.add")
  })

  it("get() returns the plugin by slug", async () => {
    const plugin = await Effect.gen(function* () {
      const registry = yield* PluginRegistry
      return yield* registry.get("lldap-group-membership")
    }).pipe(Effect.provide(PluginRegistryLive), Effect.runPromise)

    expect(plugin.manifest.slug).toBe("lldap-group-membership")
  })

  it("get() fails with PluginNotFound for unknown slugs", async () => {
    const result = await Effect.gen(function* () {
      const registry = yield* PluginRegistry
      return yield* Effect.either(registry.get("does-not-exist"))
    }).pipe(Effect.provide(PluginRegistryLive), Effect.runPromise)

    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("PluginNotFound")
    }
  })
})
