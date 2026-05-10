import { Effect } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { ApplicationRepo } from "~/lib/governance/ApplicationRepo.server"
import { GrantRepo } from "~/lib/governance/GrantRepo.server"
import { AccessRequestRepo } from "~/lib/governance/AccessRequestRepo.server"
import { decodeRole, type Application, type Role } from "~/lib/governance/types"

export type AppCatalogState =
  | "open"
  | "granted_can_upgrade"
  | "granted_full"
  | "pending"
  | "requestable"
  | "invite_only"

export interface AppCatalogEntry {
  app: Application
  state: AppCatalogState
  /** Roles the user already holds an active grant for on this app. */
  grantedRoleIds: string[]
  /** Targets (role or entitlement) the user has a pending request for on this app. */
  pendingTargets: Array<{ kind: "role" | "entitlement"; id: string }>
  /** All roles defined on the app (sent down for the dialog combobox). */
  roles: ReadonlyArray<Pick<Role, "id" | "slug" | "displayName">>
  /** Roles the user could meaningfully request (no active grant + no pending request). */
  requestableRoleIds: ReadonlyArray<string>
}

/**
 * Pure mapping from "what does the user have / what's pending" → catalog
 * state. Exported so the matrix can be unit-tested without booting the DB.
 */
export const computeState = (
  app: Pick<Application, "accessMode">,
  grantedRoleIds: ReadonlySet<string>,
  pendingRoleIds: ReadonlySet<string>,
  pendingEntitlementIds: ReadonlySet<string>,
  totalRoles: number,
): AppCatalogState => {
  if (app.accessMode === "open") return "open"
  if (pendingRoleIds.size > 0 || pendingEntitlementIds.size > 0) return "pending"
  if (grantedRoleIds.size === 0) {
    return app.accessMode === "invite_only" ? "invite_only" : "requestable"
  }
  return totalRoles > 0 && grantedRoleIds.size >= totalRoles ? "granted_full" : "granted_can_upgrade"
}

export const loadAppsCatalogForPrincipal = (principalId: string) =>
  Effect.gen(function* () {
    const appRepo = yield* ApplicationRepo
    const grantRepo = yield* GrantRepo
    const requestRepo = yield* AccessRequestRepo
    const sql = yield* SqlClient.SqlClient

    const allApps = yield* appRepo.list()
    const enabledApps = allApps.filter((a) => a.enabled !== false)
    const grants = yield* grantRepo.findActiveForPrincipal(principalId)
    const requests = yield* requestRepo.listForRequester(principalId)
    const pending = requests.filter((r) => r.status === "pending")

    // Single SQL for every role on every enabled app. Empty short-circuit
    // avoids the `IN ()` syntax error pglite would emit for an empty list.
    const rolesByApp = new Map<string, Role[]>()
    if (enabledApps.length > 0) {
      const appIds = enabledApps.map((a) => a.id)
      const roleRows =
        yield* sql`SELECT * FROM roles WHERE application_id IN ${sql.in(appIds)} ORDER BY display_name ASC`
      for (const row of roleRows) {
        const role = decodeRole(row) as Role
        const list = rolesByApp.get(role.applicationId) ?? []
        list.push(role)
        rolesByApp.set(role.applicationId, list)
      }
    }

    return enabledApps.map<AppCatalogEntry>((app) => {
      const roles = rolesByApp.get(app.id) ?? []
      const appRoleIds = new Set(roles.map((r) => r.id))
      const grantedRoleIds = new Set(
        grants.filter((g) => g.roleId && appRoleIds.has(g.roleId)).map((g) => g.roleId as string),
      )
      const appPending = pending.filter((p) => p.applicationId === app.id)
      const pendingRoleIds = new Set(appPending.flatMap((p) => (p.roleId ? [p.roleId] : [])))
      const pendingEntIds = new Set(appPending.flatMap((p) => (p.entitlementId ? [p.entitlementId] : [])))

      const requestableRoleIds = roles
        .filter((r) => !grantedRoleIds.has(r.id) && !pendingRoleIds.has(r.id))
        .map((r) => r.id)

      const pendingTargets: AppCatalogEntry["pendingTargets"] = []
      for (const p of appPending) {
        if (p.roleId) pendingTargets.push({ kind: "role", id: p.roleId })
        else if (p.entitlementId) pendingTargets.push({ kind: "entitlement", id: p.entitlementId })
      }

      return {
        app,
        state: computeState(app, grantedRoleIds, pendingRoleIds, pendingEntIds, roles.length),
        grantedRoleIds: [...grantedRoleIds],
        pendingTargets,
        roles: roles.map((r) => ({ id: r.id, slug: r.slug, displayName: r.displayName })),
        requestableRoleIds,
      }
    })
  })
