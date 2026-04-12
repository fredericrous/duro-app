import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import { makeScopedVaultClient } from "./ScopedVaultClient"
import type { PluginManifest } from "../contracts"
import { ScopeViolation } from "../errors"

const manifest: PluginManifest = {
  slug: "test-plugin",
  version: "1.0.0",
  displayName: "Test",
  description: "test",
  capabilities: ["vault.secret.read"],
  allowedDomains: [],
  ownedLldapGroups: [],
  vaultSecrets: ["my-token"],
  configSchema: {} as any,
  permissionStrategy: { byRoleSlug: {} },
  imperative: false,
  timeoutMs: 10000,
}

describe("ScopedVaultClient", () => {
  it("reads a declared secret via the provided vault read function", async () => {
    const readFn = (path: string) => Effect.succeed(`secret-for-${path}`)
    const scoped = makeScopedVaultClient(manifest, readFn)

    const value = await Effect.runPromise(scoped.readSecret("my-token"))
    expect(value).toBe("secret-for-secret/data/duro/plugins/test-plugin/secrets/my-token")
  })

  it("rejects undeclared secrets with ScopeViolation", async () => {
    const readFn = (path: string) => Effect.succeed(`secret-for-${path}`)
    const scoped = makeScopedVaultClient(manifest, readFn)

    const result = await Effect.runPromise(Effect.either(scoped.readSecret("not-declared")))
    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(ScopeViolation)
      expect(result.left.target).toBe("not-declared")
    }
  })

  it("fails when no vault read function is provided (non-dev)", async () => {
    const scoped = makeScopedVaultClient(manifest)

    const result = await Effect.runPromise(Effect.either(scoped.readSecret("my-token")))
    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left.message).toContain("not found")
    }
  })
})
