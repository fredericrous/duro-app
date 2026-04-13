import { Effect } from "effect"
import { RbacRepo, type RbacRepoError } from "./RbacRepo.server"

export const STARTER_ENTITLEMENTS = [
  { slug: "read", displayName: "Read", description: "View resources" },
  { slug: "write", displayName: "Write", description: "Create and modify resources" },
  { slug: "manage", displayName: "Manage", description: "Administer the application" },
] as const

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

/**
 * Create the starter RBAC template (3 entitlements, 3 roles, 6 attachments) for an app.
 * Caller is responsible for running this inside a transaction so failures roll back.
 */
export const seedDefaultRbac = (appId: string): Effect.Effect<void, RbacRepoError, RbacRepo> =>
  Effect.gen(function* () {
    const rbac = yield* RbacRepo

    const entitlementIdBySlug = new Map<string, string>()
    for (const e of STARTER_ENTITLEMENTS) {
      const created = yield* rbac.createEntitlement(appId, e.slug, e.displayName, e.description)
      entitlementIdBySlug.set(e.slug, created.id)
    }

    for (const r of STARTER_ROLES) {
      const role = yield* rbac.createRole(appId, r.slug, r.displayName, r.description)
      for (const slug of r.entitlements) {
        const entId = entitlementIdBySlug.get(slug)
        if (entId) {
          yield* rbac.attachEntitlement(role.id, entId)
        }
      }
    }
  })

/**
 * True if all starter slugs (roles + entitlements) are present in the given lists.
 * Tolerates extra custom roles/entitlements added by admins.
 */
export function hasStarterTemplate(roleSlugs: ReadonlyArray<string>, entitlementSlugs: ReadonlyArray<string>): boolean {
  const r = new Set(roleSlugs)
  const e = new Set(entitlementSlugs)
  for (const slug of STARTER_ROLE_SLUGS) if (!r.has(slug)) return false
  for (const slug of STARTER_ENTITLEMENT_SLUGS) if (!e.has(slug)) return false
  return true
}
