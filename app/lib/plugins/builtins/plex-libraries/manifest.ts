import { Schema } from "effect"
import type { PluginManifest } from "../../contracts"

export const configSchema = Schema.Struct({
  plexUrl: Schema.String,
})

export type PlexLibrariesConfig = typeof configSchema.Type

export const manifest: PluginManifest = {
  slug: "plex-libraries",
  version: "1.0.0",
  displayName: "Plex library sharing",
  description:
    "Invites users to the Plex server and grants access to all libraries. " +
    "Uses the plex.tv sharing API — users are matched by email and must have or create a plex.tv account.",
  capabilities: ["http.call", "vault.secret.read"],
  allowedDomains: ["plex.daddyshome.fr", "plex.tv"],
  ownedLldapGroups: [],
  vaultSecrets: ["plex-token"],
  configSchema: configSchema as Schema.Schema<unknown, unknown>,
  permissionStrategy: { byRoleSlug: {} },
  imperative: true,
  timeoutMs: 30_000,
}
