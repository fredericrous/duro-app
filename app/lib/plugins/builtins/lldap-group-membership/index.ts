import type { Plugin, ProvisioningTemplate } from "../../contracts"
import { manifest } from "./manifest"

const provisioningTemplates: ReadonlyArray<ProvisioningTemplate> = [
  {
    appSlug: "nextcloud",
    config: { viewerGroup: "nextcloud-user", editorGroup: "nextcloud-user", adminGroup: "nextcloud-admin" },
    mappings: { viewer: "nextcloud-user", editor: "nextcloud-user", admin: "nextcloud-admin" },
  },
  {
    appSlug: "gitea",
    config: { viewerGroup: "gitea-user", editorGroup: "gitea-user", adminGroup: "gitea-admin" },
    mappings: { viewer: "gitea-user", editor: "gitea-user", admin: "gitea-admin" },
  },
  {
    appSlug: "immich",
    config: { viewerGroup: "immich-user", editorGroup: "immich-user", adminGroup: "immich-user" },
    mappings: { viewer: "immich-user", editor: "immich-user", admin: "immich-user" },
  },
]

export const lldapGroupMembershipPlugin: Plugin = {
  manifest,
  provisioningTemplates,
}
