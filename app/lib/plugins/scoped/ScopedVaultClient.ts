import { Effect } from "effect"
import type { ScopedVaultClient, PluginManifest } from "../contracts"
import { ScopeViolation } from "../errors"

/**
 * Build a scoped Vault client for read-only secret access.
 *
 * Enforces the plugin's `vaultSecrets` allowlist: any logical name not
 * in the manifest is rejected with ScopeViolation.
 *
 * Secret resolution strategy:
 * 1. Environment variable: `PLUGIN_{SLUG}_SECRET_{NAME}` (uppercased,
 *    hyphens→underscores). Populated by ExternalSecret from Vault at
 *    deploy time. This is the standard path for homelab.
 * 2. Fallback `_vaultReadFn`: runtime Vault HTTP call. Provided by
 *    PluginHost when a runtime Vault client is available (future).
 * 3. Dev mode: deterministic fake value for testing.
 */
export function makeScopedVaultClient(
  manifest: PluginManifest,
  _vaultReadFn?: (path: string) => Effect.Effect<string, unknown>,
): ScopedVaultClient {
  const isDev = process.env.NODE_ENV === "development" && process.env.VITEST !== "true"
  const allowedSet = new Set(manifest.vaultSecrets)

  const envVarName = (logicalName: string) =>
    `PLUGIN_${manifest.slug.toUpperCase().replace(/-/g, "_")}_SECRET_${logicalName.toUpperCase().replace(/-/g, "_")}`

  return {
    readSecret: (logicalName) =>
      Effect.gen(function* () {
        if (!allowedSet.has(logicalName)) {
          return yield* new ScopeViolation({
            pluginSlug: manifest.slug,
            service: "ScopedVaultClient",
            target: logicalName,
            message: `Secret '${logicalName}' not in plugin's vaultSecrets: [${manifest.vaultSecrets.join(", ")}]`,
          })
        }

        if (isDev) {
          return `dev-fake-secret-${logicalName}`
        }

        // 1. Try env var (populated by ExternalSecret from Vault)
        const envKey = envVarName(logicalName)
        const envValue = process.env[envKey]
        if (envValue) return envValue

        // 2. Try runtime Vault read function
        if (_vaultReadFn) {
          const path = `secret/data/duro/plugins/${manifest.slug}/secrets/${logicalName}`
          return yield* _vaultReadFn(path).pipe(
            Effect.mapError(
              (e) =>
                new ScopeViolation({
                  pluginSlug: manifest.slug,
                  service: "ScopedVaultClient",
                  target: logicalName,
                  message: `Failed to read Vault secret at ${path}: ${e instanceof Error ? e.message : String(e)}`,
                }),
            ),
          )
        }

        return yield* new ScopeViolation({
          pluginSlug: manifest.slug,
          service: "ScopedVaultClient",
          target: logicalName,
          message: `Secret '${logicalName}' not found. Expected env var ${envKey} or a runtime Vault client.`,
        })
      }),
  }
}
