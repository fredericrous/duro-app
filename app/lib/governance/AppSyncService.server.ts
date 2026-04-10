import { Context, Effect, Data, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { OperatorClient, type OperatorClientError } from "~/lib/services/OperatorClient.server"
import { ApplicationRepo, type ApplicationRepoError } from "./ApplicationRepo.server"
import { RbacRepo, type RbacRepoError } from "./RbacRepo.server"
import { seedDefaultRbac } from "./defaultRbac"

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
      OperatorClient | ApplicationRepo | RbacRepo | SqlClient.SqlClient
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
          // Wrap create + starter RBAC seed in one transaction so a seed
          // failure rolls back the application row entirely.
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
              }),
            )
            .pipe(
              Effect.mapError((e) =>
                e instanceof AppSyncError ? e : new AppSyncError({ message: `Transaction failed for ${app.id}`, cause: e }),
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
