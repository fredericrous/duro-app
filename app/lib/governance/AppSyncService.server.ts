import { Context, Effect, Data, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { OperatorClient, type OperatorClientError } from "~/lib/services/OperatorClient.server"
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
}

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
    readonly syncFromCluster: () => Effect.Effect<
      SyncResult,
      AppSyncError,
      | OperatorClient
      | ApplicationRepo
      | RbacRepo
      | ConnectedSystemRepo
      | ConnectorMappingRepo
      | PluginRegistry
      | SqlClient.SqlClient
    >
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

/**
 * Idempotent backfill of additional roles, ConnectedSystem, and ConnectorMappings
 * for plugin-provisioned apps. Templates are declared by the plugins themselves
 * and indexed by the PluginRegistry at startup.
 */
const ensurePluginProvisioning = (appId: string, slug: string) =>
  Effect.gen(function* () {
    const registry = yield* PluginRegistry
    const rbac = yield* RbacRepo
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

const ensureSinglePlugin = (appId: string, slug: string, reg: ProvisioningTemplateRegistration) =>
  Effect.gen(function* () {
    const connectedSystems = yield* ConnectedSystemRepo
    const connectorMappings = yield* ConnectorMappingRepo
    const rbac = yield* RbacRepo

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

export const AppSyncServiceLive = Layer.succeed(AppSyncService, {
  syncFromCluster: () =>
    Effect.gen(function* () {
      const operator = yield* OperatorClient
      const appRepo = yield* ApplicationRepo
      const sql = yield* SqlClient.SqlClient

      const clusterApps = yield* operator
        .listApps()
        .pipe(Effect.mapError((e: OperatorClientError) => new AppSyncError({ message: e.message, cause: e.cause })))

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
                )

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
                )

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

      for (const existing of existingApps) {
        if (!clusterSlugs.has(existing.slug) && existing.enabled) {
          yield* appRepo
            .update(existing.id, { enabled: false })
            .pipe(Effect.mapError(wrapAppRepoErr(`Failed to disable app ${existing.slug}`)))
          disabled++
        }
      }

      return { created, updated, disabled, total: clusterApps.length } satisfies SyncResult
    }),
})
