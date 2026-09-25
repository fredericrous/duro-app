import { Context, Effect, Data, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { type ClusterApp, OperatorClient, type OperatorClientError } from "~/lib/services/OperatorClient.server"
import { ApplicationRepo, type ApplicationRepoError } from "./ApplicationRepo.server"
import { RbacRepo, type RbacRepoError } from "./RbacRepo.server"
import { ConnectedSystemRepo, type ConnectedSystemRepoError } from "./ConnectedSystemRepo.server"
import { ConnectorMappingRepo, type ConnectorMappingRepoError } from "./ConnectorMappingRepo.server"
import { seedDefaultRbac } from "./defaultRbac.server"
import { PluginRegistry, type ProvisioningTemplateRegistration } from "~/lib/plugins/PluginRegistry.server"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncResult {
  created: number
  updated: number
  disabled: number
  total: number
  /**
   * Apps the sync would have disabled but did not, because there were too many
   * at once to be a real removal (see MAX_DISABLE_*). Logged as an error.
   */
  disableRefused?: number
}

/** A conditional sync: nothing to do when the operator's list is unchanged. */
export type ConditionalSyncResult =
  | { readonly changed: false }
  | { readonly changed: true; readonly result: SyncResult; readonly etag: string | null }

/**
 * The disable guard. A sync disables every previously synced app missing from
 * the operator's list; fine behind a human's click, dangerous unattended: an
 * operator mid-restart, a half-populated informer cache, or a namespace deleted
 * by mistake would switch off apps (and every grant check on them) wholesale.
 * More than this many disables in one pass is treated as a bad list, not a
 * real removal: none are applied, the rest of the sync still runs.
 */
export const MAX_DISABLE_ABSOLUTE = 2
export const MAX_DISABLE_FRACTION = 0.2

export const disableLimit = (syncedApps: number): number =>
  Math.max(MAX_DISABLE_ABSOLUTE, Math.floor(syncedApps * MAX_DISABLE_FRACTION))

export class AppSyncError extends Data.TaggedError("AppSyncError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

export class AppSyncService extends Context.Tag("AppSyncService")<
  AppSyncService,
  {
    readonly syncFromCluster: () => Effect.Effect<SyncResult, AppSyncError>
    /**
     * Sync only if the operator's list changed since `etag` (null = always).
     * What the worker calls every minute; a 304 costs one tiny request.
     */
    readonly syncIfChanged: (etag: string | null) => Effect.Effect<ConditionalSyncResult, AppSyncError>
  }
>() {}

// ---------------------------------------------------------------------------
// Live implementation
// ---------------------------------------------------------------------------

const wrapAppRepoErr = (msg: string) => (e: ApplicationRepoError) => new AppSyncError({ message: msg, cause: e })
const wrapRbacRepoErr = (msg: string) => (e: RbacRepoError) => new AppSyncError({ message: msg, cause: e })
const wrapConnectedSystemErr = (msg: string) => (e: ConnectedSystemRepoError) =>
  new AppSyncError({ message: msg, cause: e })
const wrapConnectorMappingErr = (msg: string) => (e: ConnectorMappingRepoError) =>
  new AppSyncError({ message: msg, cause: e })

export const AppSyncServiceLive = Layer.effect(
  AppSyncService,
  Effect.gen(function* () {
    const operator = yield* OperatorClient
    const appRepo = yield* ApplicationRepo
    const rbac = yield* RbacRepo
    const connectedSystems = yield* ConnectedSystemRepo
    const connectorMappings = yield* ConnectorMappingRepo
    const registry = yield* PluginRegistry
    const sql = yield* SqlClient.SqlClient

    /**
     * Idempotent backfill of additional roles, ConnectedSystem, and ConnectorMappings
     * for plugin-provisioned apps. Templates are declared by the plugins themselves
     * and indexed by the PluginRegistry at startup.
     */
    const ensurePluginProvisioning = (appId: string, slug: string) =>
      Effect.gen(function* () {
        const templates = registry.getTemplatesForApp(slug)
        if (templates.length === 0) return

        for (const reg of templates) {
          if (reg.template.additionalRoles) {
            for (const roleDef of reg.template.additionalRoles) {
              const role = yield* rbac
                .ensureRole(appId, roleDef.slug, roleDef.displayName, roleDef.description)
                .pipe(Effect.mapError(wrapRbacRepoErr(`Failed to ensure additional role ${roleDef.slug} for ${slug}`)))

              if (roleDef.entitlements) {
                const ents = yield* rbac
                  .listEntitlements(appId)
                  .pipe(Effect.mapError(wrapRbacRepoErr(`Failed to list entitlements for ${slug}`)))
                for (const entSlug of roleDef.entitlements) {
                  const ent = ents.find((e) => e.slug === entSlug)
                  if (ent) {
                    yield* rbac
                      .attachEntitlement(role.id, ent.id)
                      .pipe(Effect.mapError(wrapRbacRepoErr(`Failed to attach ${entSlug} to ${roleDef.slug}`)))
                  }
                }
              }
            }
          }

          yield* ensureSinglePlugin(appId, slug, reg)
        }
      })

    /**
     * The "admins see every app" rule: bundle this app's `access` entitlement into
     * the `duro` admin role, so any admin (lldap_admin → duro admin grant, seeded in
     * migration 0025) sees the app on the home grid without a re-login. No-op until
     * the duro app + its admin role exist. Idempotent — mirrors migration 0026 step
     * 2 (which backfilled the pre-existing apps), scoped to a single app so newly
     * synced apps like social-planner get grid visibility automatically.
     */
    const ensureAdminSeesApp = (appId: string, slug: string) =>
      sql`
        INSERT INTO role_entitlements (role_id, entitlement_id)
        SELECT ar.id, e.id
        FROM entitlements e
        JOIN roles ar ON ar.slug = 'admin'
        JOIN applications da ON da.id = ar.application_id AND da.slug = 'duro'
        WHERE e.application_id = ${appId} AND e.slug = 'access'
        ON CONFLICT (role_id, entitlement_id) DO NOTHING
      `.pipe(
        Effect.asVoid,
        Effect.mapError(
          (e) =>
            new AppSyncError({ message: `Failed to bundle access for ${slug} into the duro admin role`, cause: e }),
        ),
      )

    const ensureSinglePlugin = (appId: string, slug: string, reg: ProvisioningTemplateRegistration) =>
      Effect.gen(function* () {
        let system = yield* connectedSystems
          .findByApplicationAndPlugin(appId, reg.pluginSlug)
          .pipe(
            Effect.mapError(wrapConnectedSystemErr(`Failed to look up plugin system ${reg.pluginSlug} for ${slug}`)),
          )

        if (!system) {
          system = yield* connectedSystems
            .create({
              applicationId: appId,
              connectorType: "plugin",
              config: reg.template.config,
              status: "active",
              pluginSlug: reg.pluginSlug,
              pluginVersion: reg.pluginVersion,
            })
            .pipe(Effect.mapError(wrapConnectedSystemErr(`Failed to create plugin system for ${slug}`)))
        }

        const roles = yield* rbac
          .listRoles(appId)
          .pipe(Effect.mapError(wrapRbacRepoErr(`Failed to list roles for ${slug}`)))

        for (const role of roles) {
          const externalRoleIdentifier = reg.template.mappings[role.slug]
          if (!externalRoleIdentifier) continue
          yield* connectorMappings
            .ensureForRole({
              connectedSystemId: system.id,
              localRoleId: role.id,
              externalRoleIdentifier,
              direction: "push",
            })
            .pipe(Effect.mapError(wrapConnectorMappingErr(`Failed to ensure mapping for ${slug}/${role.slug}`)))
        }
      })

    const syncApps = (clusterApps: readonly ClusterApp[]) =>
      Effect.gen(function* () {
        // An empty list is never "every app was removed"; it is an operator
        // that has not filled its cache yet. Syncing it would disable them all.
        if (clusterApps.length === 0) {
          return yield* new AppSyncError({ message: "Operator returned no apps; refusing to sync an empty list" })
        }

        const existingApps = yield* appRepo.list().pipe(Effect.mapError(wrapAppRepoErr("Failed to list applications")))

        const existingBySlug = new Map(existingApps.map((a) => [a.slug, a]))
        const clusterSlugs = new Set(clusterApps.map((a) => a.id))

        let created = 0
        let updated = 0
        let disabled = 0

        for (const app of clusterApps) {
          const existing = existingBySlug.get(app.id)
          const now = new Date().toISOString()

          if (!existing) {
            yield* sql
              .withTransaction(
                Effect.gen(function* () {
                  const createdApp = yield* appRepo
                    .create({
                      slug: app.id,
                      displayName: app.name,
                      description: app.category,
                      lastSyncedAt: now,
                    })
                    .pipe(Effect.mapError(wrapAppRepoErr(`Failed to create app ${app.id}`)))

                  yield* seedDefaultRbac(createdApp.id).pipe(
                    Effect.mapError(wrapRbacRepoErr(`Failed to seed starter RBAC for ${app.id}`)),
                    Effect.provideService(RbacRepo, rbac),
                  )

                  yield* ensureAdminSeesApp(createdApp.id, app.id)

                  yield* ensurePluginProvisioning(createdApp.id, app.id)
                }),
              )
              .pipe(
                Effect.mapError((e) =>
                  e instanceof AppSyncError
                    ? e
                    : new AppSyncError({ message: `Transaction failed for ${app.id}`, cause: e }),
                ),
              )
            created++
          } else {
            yield* sql
              .withTransaction(
                Effect.gen(function* () {
                  const fields: { displayName?: string; lastSyncedAt: string } = { lastSyncedAt: now }
                  if (existing.displayName !== app.name) {
                    fields.displayName = app.name
                    updated++
                  }
                  yield* appRepo
                    .update(existing.id, fields)
                    .pipe(Effect.mapError(wrapAppRepoErr(`Failed to update app ${app.id}`)))

                  yield* seedDefaultRbac(existing.id).pipe(
                    Effect.mapError(wrapRbacRepoErr(`Failed to ensure starter RBAC for ${app.id}`)),
                    Effect.provideService(RbacRepo, rbac),
                  )

                  yield* ensureAdminSeesApp(existing.id, existing.slug)

                  yield* ensurePluginProvisioning(existing.id, existing.slug)
                }),
              )
              .pipe(
                Effect.mapError((e) =>
                  e instanceof AppSyncError
                    ? e
                    : new AppSyncError({ message: `Transaction failed for existing ${app.id}`, cause: e }),
                ),
              )
          }
        }

        // Only auto-disable apps that were previously discovered from the
        // cluster (last_synced_at set) but are now gone. Never disable an app
        // that never came from a sync (last_synced_at null) — e.g. the
        // migration-seeded `duro` portal, which is intentionally absent from the
        // operator list. Disabling it would make the AuthzEngine (which resolves
        // only `enabled = TRUE` apps) stop resolving `duro`, breaking the admin
        // gate and locking admins out.
        const toDisable = existingApps.filter(
          (existing) => !clusterSlugs.has(existing.slug) && existing.enabled && existing.lastSyncedAt != null,
        )
        const synced = existingApps.filter((a) => a.lastSyncedAt != null && a.enabled).length
        const limit = disableLimit(synced)
        if (toDisable.length > limit) {
          yield* Effect.logError(
            `app sync: refusing to disable ${toDisable.length} of ${synced} synced apps at once (limit ${limit}); ` +
              `the operator list is more likely wrong than that many apps removed. Missing: ` +
              toDisable.map((a) => a.slug).join(", "),
          )
          return {
            created,
            updated,
            disabled: 0,
            total: clusterApps.length,
            disableRefused: toDisable.length,
          } satisfies SyncResult
        }
        for (const existing of toDisable) {
          yield* appRepo
            .update(existing.id, { enabled: false })
            .pipe(Effect.mapError(wrapAppRepoErr(`Failed to disable app ${existing.slug}`)))
          disabled++
        }

        return { created, updated, disabled, total: clusterApps.length } satisfies SyncResult
      })

    const fromOperator = (e: OperatorClientError) => new AppSyncError({ message: e.message, cause: e.cause })

    return {
      syncFromCluster: () => operator.listApps().pipe(Effect.mapError(fromOperator), Effect.flatMap(syncApps)),

      syncIfChanged: (etag) =>
        operator.listAppsIfChanged(etag).pipe(
          Effect.mapError(fromOperator),
          Effect.flatMap((res) =>
            res.changed
              ? syncApps(res.apps).pipe(
                  Effect.map((result): ConditionalSyncResult => ({ changed: true, result, etag: res.etag })),
                )
              : Effect.succeed<ConditionalSyncResult>({ changed: false }),
          ),
        ),
    }
  }),
)
