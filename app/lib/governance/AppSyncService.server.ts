import { Context, Effect, Data, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { OperatorClient, type OperatorClientError } from "~/lib/services/OperatorClient.server"
import { ApplicationRepo, type ApplicationRepoError } from "./ApplicationRepo.server"
import { RbacRepo, type RbacRepoError } from "./RbacRepo.server"
import { ConnectedSystemRepo, type ConnectedSystemRepoError } from "./ConnectedSystemRepo.server"
import { ConnectorMappingRepo, type ConnectorMappingRepoError } from "./ConnectorMappingRepo.server"
import { seedDefaultRbac } from "./defaultRbac"

// ---------------------------------------------------------------------------
// Known LDAP-provisioned apps. Hardcoded allow-list for phase 1.
// Each entry maps the starter role slug → LLDAP group name.
// ---------------------------------------------------------------------------

interface LdapProvisioningTemplate {
  readonly slug: string
  readonly groupForRole: Record<string, string> // role slug → group name
}

const LDAP_PROVISIONING_TEMPLATES: ReadonlyArray<LdapProvisioningTemplate> = [
  {
    slug: "nextcloud",
    groupForRole: { viewer: "nextcloud-user", editor: "nextcloud-user", admin: "nextcloud-admin" },
  },
  {
    slug: "gitea",
    groupForRole: { viewer: "gitea-user", editor: "gitea-user", admin: "gitea-admin" },
  },
  {
    slug: "immich",
    groupForRole: { viewer: "immich-user", editor: "immich-user", admin: "immich-user" },
  },
]

export const LDAP_PROVISIONING_SLUGS: ReadonlySet<string> = new Set(
  LDAP_PROVISIONING_TEMPLATES.map((t) => t.slug),
)

const findTemplate = (slug: string) => LDAP_PROVISIONING_TEMPLATES.find((t) => t.slug === slug)

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
      | SqlClient.SqlClient
    >
  }
>() {}

// ---------------------------------------------------------------------------
// Live implementation
// ---------------------------------------------------------------------------

const wrapAppRepoErr = (msg: string) => (e: ApplicationRepoError) =>
  new AppSyncError({ message: msg, cause: e })
const wrapRbacRepoErr = (msg: string) => (e: RbacRepoError) =>
  new AppSyncError({ message: msg, cause: e })
const wrapConnectedSystemErr = (msg: string) => (e: ConnectedSystemRepoError) =>
  new AppSyncError({ message: msg, cause: e })
const wrapConnectorMappingErr = (msg: string) => (e: ConnectorMappingRepoError) =>
  new AppSyncError({ message: msg, cause: e })

/**
 * Idempotent backfill of ConnectedSystem + ConnectorMappings for known LDAP-
 * provisioned apps. Runs on every sync, not just first create. Never calls
 * LLDAP (invariant 6) — groups are pre-created by the LLDAP bootstrap job.
 */
const ensureLdapProvisioning = (appId: string, slug: string) =>
  Effect.gen(function* () {
    const template = findTemplate(slug)
    if (!template) return

    const connectedSystems = yield* ConnectedSystemRepo
    const connectorMappings = yield* ConnectorMappingRepo
    const rbac = yield* RbacRepo

    // 1. Find or create the ConnectedSystem row
    let system = yield* connectedSystems
      .findByApplicationAndType(appId, "ldap")
      .pipe(Effect.mapError(wrapConnectedSystemErr(`Failed to look up LDAP system for ${slug}`)))

    if (!system) {
      system = yield* connectedSystems
        .create({
          applicationId: appId,
          connectorType: "ldap",
          config: { groupPrefix: slug },
          status: "active",
        })
        .pipe(Effect.mapError(wrapConnectedSystemErr(`Failed to create LDAP system for ${slug}`)))
    }

    // 2. For each existing role matching a template entry, upsert a mapping
    const roles = yield* rbac
      .listRoles(appId)
      .pipe(Effect.mapError(wrapRbacRepoErr(`Failed to list roles for ${slug}`)))

    for (const role of roles) {
      const externalRoleIdentifier = template.groupForRole[role.slug]
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

      const existingApps = yield* appRepo
        .list()
        .pipe(Effect.mapError(wrapAppRepoErr("Failed to list applications")))

      const existingBySlug = new Map(existingApps.map((a) => [a.slug, a]))
      const clusterSlugs = new Set(clusterApps.map((a) => a.id))

      let created = 0
      let updated = 0
      let disabled = 0

      for (const app of clusterApps) {
        const existing = existingBySlug.get(app.id)
        const now = new Date().toISOString()

        if (!existing) {
          // Wrap create + starter RBAC seed + LDAP provisioning backfill in
          // one transaction so any failure rolls back the app row.
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

                yield* ensureLdapProvisioning(createdApp.id, app.id)
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
          const fields: { displayName?: string; lastSyncedAt: string } = { lastSyncedAt: now }
          if (existing.displayName !== app.name) {
            fields.displayName = app.name
            updated++
          }
          yield* appRepo
            .update(existing.id, fields)
            .pipe(Effect.mapError(wrapAppRepoErr(`Failed to update app ${app.id}`)))

          // Idempotent backfill on every sync for known-slug apps. Catches
          // apps that were synced before provisioning existed.
          yield* ensureLdapProvisioning(existing.id, existing.slug)
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
