export const STARTER_ENTITLEMENTS = [
  { slug: "read", displayName: "Read", description: "View resources" },
  { slug: "write", displayName: "Write", description: "Create and modify resources" },
  { slug: "manage", displayName: "Manage", description: "Administer the application" },
] as const

/**
 * The `access` entitlement gates *home-grid visibility* (home.tsx checks the
 * engine for action="access"), which is a distinct concept from the read/write/
 * manage RBAC verbs — so it lives outside STARTER_ENTITLEMENTS and is not
 * attached to any starter role. Every registered app gets it (seedDefaultRbac);
 * admins see all apps by bundling it into the duro admin role (see AppSyncService).
 */
export const ACCESS_ENTITLEMENT = {
  slug: "access",
  displayName: "Access",
  description: "Grants visibility of this app on the home grid",
} as const

export const STARTER_ROLES = [
  {
    slug: "viewer",
    displayName: "Viewer",
    description: "Read-only access (starter template — review before granting)",
    entitlements: ["read"] as const,
  },
  {
    slug: "editor",
    displayName: "Editor",
    description: "Read and write (starter template — review before granting)",
    entitlements: ["read", "write"] as const,
  },
  {
    slug: "admin",
    displayName: "Admin",
    description: "Full administrative access (starter template — review before granting)",
    entitlements: ["read", "write", "manage"] as const,
  },
] as const

export const STARTER_ROLE_SLUGS: ReadonlySet<string> = new Set(STARTER_ROLES.map((r) => r.slug))
export const STARTER_ENTITLEMENT_SLUGS: ReadonlySet<string> = new Set(STARTER_ENTITLEMENTS.map((e) => e.slug))

export function hasStarterTemplate(roleSlugs: ReadonlyArray<string>, entitlementSlugs: ReadonlyArray<string>): boolean {
  const r = new Set(roleSlugs)
  const e = new Set(entitlementSlugs)
  for (const slug of STARTER_ROLE_SLUGS) if (!r.has(slug)) return false
  for (const slug of STARTER_ENTITLEMENT_SLUGS) if (!e.has(slug)) return false
  return true
}
