import { Context, Effect, Layer } from "effect"
import type { Plugin, PluginManifest, PluginCapability } from "./contracts"
import { isReversible, PLUGIN_CAPABILITIES } from "./contracts"
import { ManifestInvalid, PluginNotFound } from "./errors"
import { lldapGroupMembershipPlugin } from "./builtins/lldap-group-membership"

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

export class PluginRegistry extends Context.Tag("PluginRegistry")<
  PluginRegistry,
  {
    readonly get: (slug: string) => Effect.Effect<Plugin, PluginNotFound>
    readonly list: () => Effect.Effect<ReadonlyArray<PluginManifest>>
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

  // Imperative plugins must provide provision function
  if (manifest.imperative) {
    // Validation of the Plugin object's provision field happens at registration
    // time, not here (manifest doesn't have the function reference)
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

// ---------------------------------------------------------------------------
// Live layer
// ---------------------------------------------------------------------------

export const PluginRegistryLive = Layer.sync(PluginRegistry, () => {
  const plugins: ReadonlyArray<Plugin> = [
    lldapGroupMembershipPlugin,
    // Future: giteaTeamsPlugin, immichAdminBitPlugin, ...
  ]

  const existingSlugs = new Set<string>()
  for (const p of plugins) {
    validateManifest(p.manifest, existingSlugs)
    validatePlugin(p)
  }

  const bySlug = new Map(plugins.map((p) => [p.manifest.slug, p]))

  return {
    get: (slug) =>
      bySlug.has(slug)
        ? Effect.succeed(bySlug.get(slug)!)
        : Effect.fail(new PluginNotFound({ slug })),
    list: () => Effect.succeed(plugins.map((p) => p.manifest)),
  }
})
