import { Schema } from "effect"
import type { PluginManifest } from "../../contracts"

export const configSchema = Schema.Struct({
  giteaUrl: Schema.String,
  orgName: Schema.String,
  viewerTeamName: Schema.String,
  editorTeamName: Schema.String,
  adminTeamName: Schema.String,
})

export type GiteaTeamsConfig = typeof configSchema.Type

export const manifest: PluginManifest = {
  slug: "gitea-teams",
  version: "1.0.0",
  displayName: "Gitea team membership",
  description:
    "Provisions Gitea org team membership via the admin API. Viewer/editor/admin map to separate teams with different permission levels.",
  capabilities: ["http.call", "vault.secret.read"],
  allowedDomains: ["gitea.daddyshome.fr"],
  ownedLldapGroups: [],
  vaultSecrets: ["token"],
  configSchema: configSchema as Schema.Schema<unknown, unknown>,
  permissionStrategy: { byRoleSlug: {} },
  imperative: true,
  timeoutMs: 20_000,
}
