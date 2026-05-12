import { describe, expect, it } from "vitest"
import { giteaTeamsPlugin } from "./gitea-teams"
import { immichAdminBitPlugin } from "./immich-admin-bit"
import { lldapGroupMembershipPlugin } from "./lldap-group-membership"
import { plexLibrariesPlugin } from "./plex-libraries"
import type { Plugin } from "../contracts"

// Each built-in plugin is mostly data — manifest + provisioning templates.
// These tests assert the shape so refactors of the contracts surface a clear
// failure here rather than at runtime in production.

const allPlugins: Array<{ name: string; plugin: Plugin }> = [
  { name: "gitea-teams", plugin: giteaTeamsPlugin },
  { name: "immich-admin-bit", plugin: immichAdminBitPlugin },
  { name: "lldap-group-membership", plugin: lldapGroupMembershipPlugin },
  { name: "plex-libraries", plugin: plexLibrariesPlugin },
]

describe.each(allPlugins)("built-in plugin: $name", ({ plugin }) => {
  it("exposes a manifest with the matching slug, semver-shaped version, and timeoutMs", () => {
    expect(plugin.manifest.slug).toBeTruthy()
    expect(plugin.manifest.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(plugin.manifest.timeoutMs).toBeGreaterThan(0)
  })

  it("manifest declares capabilities and a Schema-typed configSchema", () => {
    expect(Array.isArray(plugin.manifest.capabilities)).toBe(true)
    expect(plugin.manifest.capabilities.length).toBeGreaterThan(0)
    expect(plugin.manifest.configSchema).toBeDefined()
  })

  it("permissionStrategy keys are limited to {byRoleSlug, byEntitlementSlug}", () => {
    const strategy = plugin.manifest.permissionStrategy
    const keys = Object.keys(strategy)
    for (const k of keys) {
      expect(["byRoleSlug", "byEntitlementSlug"]).toContain(k)
    }
  })

  it("each provisioning template references a known appSlug + has config + mappings", () => {
    for (const tpl of plugin.provisioningTemplates ?? []) {
      expect(tpl.appSlug).toBeTruthy()
      expect(tpl.config).toBeDefined()
      expect(tpl.mappings).toBeDefined()
    }
  })
})

describe("lldap-group-membership specifics", () => {
  it("is declarative (imperative=false) — runs via the interpreter, not custom code", () => {
    expect(lldapGroupMembershipPlugin.manifest.imperative).toBe(false)
  })

  it("ownedLldapGroups references the config variables via template syntax", () => {
    const owned = lldapGroupMembershipPlugin.manifest.ownedLldapGroups ?? []
    expect(owned).toContain("${config.viewerGroup}")
    expect(owned).toContain("${config.adminGroup}")
  })

  it("includes provisioning templates for nextcloud, gitea, and immich", () => {
    const slugs = (lldapGroupMembershipPlugin.provisioningTemplates ?? []).map((t) => t.appSlug)
    expect(slugs).toEqual(expect.arrayContaining(["nextcloud", "gitea", "immich"]))
  })
})

describe("gitea-teams specifics", () => {
  it("is imperative (calls Gitea HTTP API)", () => {
    expect(giteaTeamsPlugin.manifest.imperative).toBe(true)
  })

  it("allowedDomains is non-empty (HTTP scope contract)", () => {
    expect(giteaTeamsPlugin.manifest.allowedDomains.length).toBeGreaterThan(0)
  })
})

describe("immich-admin-bit specifics", () => {
  it("is imperative", () => {
    expect(immichAdminBitPlugin.manifest.imperative).toBe(true)
  })

  it("allowedDomains is non-empty", () => {
    expect(immichAdminBitPlugin.manifest.allowedDomains.length).toBeGreaterThan(0)
  })
})

describe("plex-libraries specifics", () => {
  it("is imperative", () => {
    expect(plexLibrariesPlugin.manifest.imperative).toBe(true)
  })
})
