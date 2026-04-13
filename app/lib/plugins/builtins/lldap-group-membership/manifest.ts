import { Schema } from "effect"
import type { PluginManifest } from "../../contracts"

export const configSchema = Schema.Struct({
  viewerGroup: Schema.String,
  editorGroup: Schema.String,
  adminGroup: Schema.String,
})

export const manifest: PluginManifest = {
  slug: "lldap-group-membership",
  version: "1.0.0",
  displayName: "LLDAP group membership",
  description:
    "Grants app access by adding/removing the principal from LLDAP groups. Declarative — no imperative code.",
  capabilities: ["lldap.group.read", "lldap.group.member.add", "lldap.group.member.remove"],
  allowedDomains: [],
  ownedLldapGroups: ["${config.viewerGroup}", "${config.editorGroup}", "${config.adminGroup}"],
  vaultSecrets: [],
  configSchema: configSchema as Schema.Schema<unknown, unknown>,
  permissionStrategy: {
    byRoleSlug: {
      viewer: [
        {
          op: "lldap.addGroupMember",
          group: "${config.viewerGroup}",
          user: "${principal.externalId}",
          reversible: true,
        },
      ],
      editor: [
        {
          op: "lldap.addGroupMember",
          group: "${config.editorGroup}",
          user: "${principal.externalId}",
          reversible: true,
        },
      ],
      admin: [
        {
          op: "lldap.addGroupMember",
          group: "${config.adminGroup}",
          user: "${principal.externalId}",
          reversible: true,
        },
      ],
    },
  },
  imperative: false,
  timeoutMs: 10_000,
}
