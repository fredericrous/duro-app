import { Schema } from "effect"
import type { PluginManifest } from "../../contracts"

export const configSchema = Schema.Struct({
  forgejoUrl: Schema.String,
  orgName: Schema.String,
  viewerTeamName: Schema.String,
  editorTeamName: Schema.String,
  adminTeamName: Schema.String,
})

export type ForgejoTeamsConfig = typeof configSchema.Type

export const manifest: PluginManifest = {
  slug: "forgejo-teams",
  version: "1.0.0",
  displayName: "Forgejo team membership",
  description:
    "Provisions Forgejo org team membership via the admin API. Viewer/editor/admin map to separate teams with different permission levels. Runs alongside gitea-teams for the duration of the forge migration so grants keep both forges in sync.",
  capabilities: ["http.call", "vault.secret.read"],
  allowedDomains: ["git.daddyshome.fr"],
  ownedLldapGroups: [],
  vaultSecrets: ["token"],
  configSchema: configSchema as Schema.Schema<unknown, unknown>,
  permissionStrategy: { byRoleSlug: {} },
  imperative: true,
  timeoutMs: 20_000,
}
