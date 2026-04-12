import { Effect } from "effect"
import type { ScopedVaultClient, PluginManifest } from "../contracts"
import { ScopeViolation } from "../errors"

/**
 * Build a scoped Vault client for read-only secret access.
 *
 * Enforces the plugin's `vaultSecrets` allowlist: any logical name not
 * in the manifest is rejected with ScopeViolation.
 *
 * Phase 2A scaffolding — the only 2A plugin declares no secrets, so
 * `readSecret` always fails with "not in manifest". Real Vault reads
 * come in 2B when gitea-teams needs a PAT.
 */
export function makeScopedVaultClient(
  manifest: PluginManifest,
  _vaultReadFn?: (path: string) => Effect.Effect<string, unknown>,
): ScopedVaultClient {
  const isDev = process.env.NODE_ENV === "development" && process.env.VITEST !== "true"
  const allowedSet = new Set(manifest.vaultSecrets)

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

        if (!_vaultReadFn) {
          return yield* new ScopeViolation({
            pluginSlug: manifest.slug,
            service: "ScopedVaultClient",
            target: logicalName,
            message: "VaultClient not configured (no _vaultReadFn provided)",
          })
        }

        const path = `duro/plugins/${manifest.slug}/secrets/${logicalName}`
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
      }),
  }
}
