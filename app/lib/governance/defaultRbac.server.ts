import { Effect } from "effect"
import { RbacRepo, type RbacRepoError } from "./RbacRepo.server"
import { STARTER_ENTITLEMENTS, STARTER_ROLES } from "./defaultRbac"

export { STARTER_ENTITLEMENTS, STARTER_ROLES, STARTER_ROLE_SLUGS, STARTER_ENTITLEMENT_SLUGS } from "./defaultRbac"
export { hasStarterTemplate } from "./defaultRbac"

export const seedDefaultRbac = (appId: string): Effect.Effect<void, RbacRepoError, RbacRepo> =>
  Effect.gen(function* () {
    const rbac = yield* RbacRepo

    const entitlementIdBySlug = new Map<string, string>()
    for (const e of STARTER_ENTITLEMENTS) {
      const ent = yield* rbac.ensureEntitlement(appId, e.slug, e.displayName, e.description)
      entitlementIdBySlug.set(e.slug, ent.id)
    }

    for (const r of STARTER_ROLES) {
      const role = yield* rbac.ensureRole(appId, r.slug, r.displayName, r.description)
      for (const slug of r.entitlements) {
        const entId = entitlementIdBySlug.get(slug)
        if (entId) {
          yield* rbac.attachEntitlement(role.id, entId)
        }
      }
    }
  })
