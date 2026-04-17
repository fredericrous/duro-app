import { Context, Effect, Layer } from "effect"
import type { Plugin, PluginManifest, PluginCapability, ProvisioningTemplate } from "./contracts"
import { isReversible, PLUGIN_CAPABILITIES } from "./contracts"
import { STARTER_ROLE_SLUGS, STARTER_ENTITLEMENT_SLUGS } from "~/lib/governance/defaultRbac"
import { ManifestInvalid, PluginNotFound } from "./errors"
import { lldapGroupMembershipPlugin } from "./builtins/lldap-group-membership"
import { giteaTeamsPlugin } from "./builtins/gitea-teams"
import { immichAdminBitPlugin } from "./builtins/immich-admin-bit"
import { plexLibrariesPlugin } from "./builtins/plex-libraries"

// ---------------------------------------------------------------------------
// Provisioning template registration — returned by registry queries
// ---------------------------------------------------------------------------

export interface ProvisioningTemplateRegistration {
  readonly pluginSlug: string
  readonly pluginVersion: string
  readonly template: ProvisioningTemplate
}

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

export class PluginRegistry extends Context.Tag("PluginRegistry")<
  PluginRegistry,
  {
    readonly get: (slug: string) => Effect.Effect<Plugin, PluginNotFound>
    readonly list: () => Effect.Effect<ReadonlyArray<PluginManifest>>
    readonly getTemplatesForApp: (appSlug: string) => ReadonlyArray<ProvisioningTemplateRegistration>
    readonly provisionedAppSlugs: () => ReadonlySet<string>
  }
>() {}

// ---------------------------------------------------------------------------
// Manifest validation — runs once at startup, fail-fast
// ---------------------------------------------------------------------------

function validateManifest(manifest: PluginManifest, existingSlugs: Set<string>): void {
  const e = (msg: string) => {
    throw new ManifestInvalid({ pluginSlug: manifest.slug, message: msg })
  }

  if (!manifest.slug || manifest.slug.length === 0) e("slug is empty")
  if (existingSlugs.has(manifest.slug)) e(`duplicate slug '${manifest.slug}'`)
  if (!manifest.version) e("version is empty")

  // Validate capabilities
  const validCaps = new Set<string>(PLUGIN_CAPABILITIES)
  for (const cap of manifest.capabilities) {
    if (!validCaps.has(cap)) e(`unknown capability '${cap}'`)
  }

  // Validate allowed domains are HTTPS-compatible
  for (const domain of manifest.allowedDomains) {
    if (domain.includes("/")) e(`allowedDomains entry '${domain}' should be a host, not a URL`)
  }

  // Validate permission strategy: non-reversible actions require imperative mode
  for (const [roleSlug, actions] of Object.entries(manifest.permissionStrategy.byRoleSlug)) {
    for (const action of actions) {
      if (!isReversible(action) && !manifest.imperative) {
        e(
          `role '${roleSlug}' uses non-reversible action '${action.op}' but plugin is not imperative — ` +
            `either make all actions reversible or set imperative: true and provide deprovision()`,
        )
      }
    }
  }

  existingSlugs.add(manifest.slug)
}

function validatePlugin(plugin: Plugin): void {
  if (plugin.manifest.imperative && !plugin.provision) {
    throw new ManifestInvalid({
      pluginSlug: plugin.manifest.slug,
      message: "imperative plugin must provide a provision function",
    })
  }
}

function validateTemplates(plugin: Plugin): void {
  const slug = plugin.manifest.slug
  const e = (msg: string) => {
    throw new ManifestInvalid({ pluginSlug: slug, message: msg })
  }

  if (!plugin.provisioningTemplates) return

  for (const tpl of plugin.provisioningTemplates) {
    if (!tpl.appSlug || tpl.appSlug.length === 0) {
      e("provisioningTemplate has empty appSlug")
    }

    const additionalSlugs = new Set<string>()
    if (tpl.additionalRoles) {
      for (const role of tpl.additionalRoles) {
        if (STARTER_ROLE_SLUGS.has(role.slug)) {
          e(`additionalRoles slug '${role.slug}' duplicates a starter role`)
        }
        if (additionalSlugs.has(role.slug)) {
          e(`duplicate additionalRoles slug '${role.slug}' in template for '${tpl.appSlug}'`)
        }
        additionalSlugs.add(role.slug)

        if (role.entitlements) {
          for (const entSlug of role.entitlements) {
            if (!STARTER_ENTITLEMENT_SLUGS.has(entSlug)) {
              e(`additionalRoles '${role.slug}' references unknown entitlement '${entSlug}'`)
            }
          }
        }
      }
    }

    for (const mappingKey of Object.keys(tpl.mappings)) {
      if (!STARTER_ROLE_SLUGS.has(mappingKey) && !additionalSlugs.has(mappingKey)) {
        e(
          `mapping key '${mappingKey}' in template for '${tpl.appSlug}' is not a starter role ` +
            `and not declared in additionalRoles`,
        )
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Live layer
// ---------------------------------------------------------------------------

export const PluginRegistryLive = Layer.sync(PluginRegistry, () => {
  const plugins: ReadonlyArray<Plugin> = [
    lldapGroupMembershipPlugin,
    giteaTeamsPlugin,
    immichAdminBitPlugin,
    plexLibrariesPlugin,
  ]

  const existingSlugs = new Set<string>()
  for (const p of plugins) {
    validateManifest(p.manifest, existingSlugs)
    validatePlugin(p)
    validateTemplates(p)
  }

  const bySlug = new Map(plugins.map((p) => [p.manifest.slug, p]))

  const templatesByApp = new Map<string, ProvisioningTemplateRegistration[]>()
  for (const p of plugins) {
    if (!p.provisioningTemplates) continue
    for (const tpl of p.provisioningTemplates) {
      const existing = templatesByApp.get(tpl.appSlug) ?? []
      existing.push({
        pluginSlug: p.manifest.slug,
        pluginVersion: p.manifest.version,
        template: tpl,
      })
      templatesByApp.set(tpl.appSlug, existing)
    }
  }

  const provisionedSlugs: ReadonlySet<string> = new Set(templatesByApp.keys())

  return {
    get: (slug) => (bySlug.has(slug) ? Effect.succeed(bySlug.get(slug)!) : Effect.fail(new PluginNotFound({ slug }))),
    list: () => Effect.succeed(plugins.map((p) => p.manifest)),
    getTemplatesForApp: (appSlug) => templatesByApp.get(appSlug) ?? [],
    provisionedAppSlugs: () => provisionedSlugs,
  }
})
