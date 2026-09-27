import { Effect } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { ApplicationRepo } from "~/lib/governance/ApplicationRepo.server"
import { GrantRepo } from "~/lib/governance/GrantRepo.server"
import { AccessRequestRepo } from "~/lib/governance/AccessRequestRepo.server"
import { AuthzEngine } from "~/lib/governance/AuthzEngine.server"
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
  /**
   * Where the user's access to this app comes from, as the AuthzEngine resolved
   * it: a role on this app, a role on another app that bundles this one's
   * `access` (the duro admin role), a direct entitlement grant, or any of those
   * held by a group the user belongs to. Empty when the user has no access.
   */
  accessVia: ReadonlyArray<AccessSource>
}

export interface AccessSource {
  /** Role name, when the grant is a role grant. */
  readonly role: string | null
  /** The role's application, when it is not this app (e.g. "Duro" for the admin role). */
  readonly roleApp: string | null
  /** Entitlement name, when the grant is a direct entitlement grant. */
  readonly entitlement: string | null
  /** The group holding the grant, when it is not the user's own. */
  readonly group: string | null
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
  /**
   * Whether the AuthzEngine allows `access` on the app, whatever the route:
   * an admin's access arrives through the duro admin role's bundle, not
   * through a role on the app, and used to read as "Request access".
   */
  hasAccess = false,
): AppCatalogState => {
  if (app.accessMode === "open") return "open"
  if (pendingRoleIds.size > 0 || pendingEntitlementIds.size > 0) return "pending"
  if (grantedRoleIds.size === 0 && !hasAccess) {
    return app.accessMode === "invite_only" ? "invite_only" : "requestable"
  }
  // Access that holds no role on the app (the admin bundle, a group's access
  // entitlement) is access, not partial access: "partial" means holding some of
  // the app's roles but not all, and reading it on every app an admin can open
  // said the opposite of the truth. Roles left to ask for are an action, shown
  // from `requestableRoleIds`, not a state.
  if (grantedRoleIds.size === 0) return "granted_full"
  if (grantedRoleIds.size >= totalRoles) return "granted_full"
  if (app.accessMode === "invite_only") return "granted_full"
  return "granted_can_upgrade"
}

export const loadAppsCatalogForPrincipal = (principalId: string) =>
  Effect.gen(function* () {
    const appRepo = yield* ApplicationRepo
    const grantRepo = yield* GrantRepo
    const requestRepo = yield* AccessRequestRepo
    const engine = yield* AuthzEngine
    const sql = yield* SqlClient.SqlClient

    const allApps = yield* appRepo.list()
    // Exclude the "duro" portal itself: it's registered as an application only
    // so the AuthzEngine can resolve it for the admin gate (see migration 0025),
    // not as something users request access to from the catalog.
    const enabledApps = allApps.filter((a) => a.enabled !== false && a.slug !== "duro")
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
        const role = yield* decodeRole(row)
        const list = rolesByApp.get(role.applicationId) ?? []
        list.push(role)
        rolesByApp.set(role.applicationId, list)
      }
    }

    // The same question the home grid asks: may this principal `access` each
    // app? One bulk call; the matched grants say *how*.
    const subjectRows = yield* sql<{ externalId: string | null }>`
      SELECT external_id FROM principals WHERE id = ${principalId}`
    const subject = subjectRows[0]?.externalId ?? null
    const decisions = subject
      ? yield* engine.checkBulk(enabledApps.map((a) => ({ subject, application: a.slug, action: "access" })))
      : enabledApps.map(() => ({ allow: false, matchedGrantIds: [] as readonly string[] }))

    const matchedIds = [...new Set(decisions.flatMap((d) => d.matchedGrantIds))]
    const sourceByGrant = new Map<string, AccessSource & { roleAppId: string | null }>()
    if (matchedIds.length > 0) {
      const rows = yield* sql<{
        id: string
        principalId: string
        principalName: string
        roleName: string | null
        roleAppId: string | null
        roleAppName: string | null
        entitlementName: string | null
      }>`
        SELECT g.id, g.principal_id, p.display_name AS principal_name,
               r.display_name AS role_name, ra.id AS role_app_id, ra.display_name AS role_app_name,
               e.display_name AS entitlement_name
        FROM grants g
        JOIN principals p ON p.id = g.principal_id
        LEFT JOIN roles r ON r.id = g.role_id
        LEFT JOIN applications ra ON ra.id = r.application_id
        LEFT JOIN entitlements e ON e.id = g.entitlement_id
        WHERE g.id IN ${sql.in(matchedIds)}`
      for (const row of rows) {
        sourceByGrant.set(row.id, {
          role: row.roleName,
          roleAppId: row.roleAppId,
          roleApp: row.roleAppName,
          entitlement: row.roleName ? null : row.entitlementName,
          group: row.principalId === principalId ? null : row.principalName,
        })
      }
    }

    return enabledApps.map<AppCatalogEntry>((app, index) => {
      const decision = decisions[index]!
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

      const seen = new Set<string>()
      const accessVia: AccessSource[] = []
      for (const grantId of decision.matchedGrantIds) {
        const src = sourceByGrant.get(grantId)
        if (!src) continue
        const roleApp = src.roleAppId && src.roleAppId !== app.id ? src.roleApp : null
        const source: AccessSource = { role: src.role, roleApp, entitlement: src.entitlement, group: src.group }
        const key = JSON.stringify(source)
        if (!seen.has(key)) {
          seen.add(key)
          accessVia.push(source)
        }
      }

      return {
        app,
        state: computeState(app, grantedRoleIds, pendingRoleIds, pendingEntIds, roles.length, decision.allow),
        accessVia,
        grantedRoleIds: [...grantedRoleIds],
        pendingTargets,
        roles: roles.map((r) => ({ id: r.id, slug: r.slug, displayName: r.displayName })),
        requestableRoleIds,
      }
    })
  })
