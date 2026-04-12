import { Schema } from "effect"
import type { PluginManifest } from "../../contracts"

export const configSchema = Schema.Struct({
  immichUrl: Schema.String,
})

export type ImmichAdminConfig = typeof configSchema.Type

export const manifest: PluginManifest = {
  slug: "immich-admin-bit",
  version: "1.0.0",
  displayName: "Immich admin promotion",
  description:
    "Sets/unsets the isAdmin flag on Immich users via the admin API. Only fires for the 'admin' role — viewer/editor grants are no-ops.",
  capabilities: ["http.call", "vault.secret.read"],
  allowedDomains: ["photos.daddyshome.fr"],
  ownedLldapGroups: [],
  vaultSecrets: ["api-key"],
  configSchema: configSchema as Schema.Schema<unknown, unknown>,
  permissionStrategy: { byRoleSlug: {} },
  imperative: true,
  timeoutMs: 15_000,
}
