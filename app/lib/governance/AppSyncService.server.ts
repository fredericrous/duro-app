import { Context, Effect, Data, Layer } from "effect"
import { OperatorClient, type OperatorClientError } from "~/lib/services/OperatorClient.server"
import { ApplicationRepo, type ApplicationRepoError } from "./ApplicationRepo.server"

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
    readonly syncFromCluster: () => Effect.Effect<SyncResult, AppSyncError, OperatorClient | ApplicationRepo>
  }
>() {}

// ---------------------------------------------------------------------------
// Live implementation
// ---------------------------------------------------------------------------

export const AppSyncServiceLive = Layer.succeed(AppSyncService, {
  syncFromCluster: () =>
    Effect.gen(function* () {
      const operator = yield* OperatorClient
      const appRepo = yield* ApplicationRepo

      // 1. Fetch apps from the operator
      const clusterApps = yield* operator.listApps().pipe(
        Effect.mapError((e: OperatorClientError) => new AppSyncError({ message: e.message, cause: e.cause })),
      )

      // 2. Fetch existing governance apps
      const existingApps = yield* appRepo.list().pipe(
        Effect.mapError((e: ApplicationRepoError) => new AppSyncError({ message: e.message, cause: e.cause })),
      )

      // 3. Build lookup by slug
      const existingBySlug = new Map(existingApps.map((a) => [a.slug, a]))
      const clusterSlugs = new Set(clusterApps.map((a) => a.id))

      let created = 0
      let updated = 0
      let disabled = 0

      // 4. Upsert cluster apps
      for (const app of clusterApps) {
        const existing = existingBySlug.get(app.id)

        if (!existing) {
          yield* appRepo
            .create({ slug: app.id, displayName: app.name, description: app.category })
            .pipe(
              Effect.mapError(
                (e: ApplicationRepoError) => new AppSyncError({ message: `Failed to create app ${app.id}`, cause: e }),
              ),
            )
          created++
        } else if (existing.displayName !== app.name) {
          yield* appRepo
            .update(existing.id, { displayName: app.name })
            .pipe(
              Effect.mapError(
                (e: ApplicationRepoError) => new AppSyncError({ message: `Failed to update app ${app.id}`, cause: e }),
              ),
            )
          updated++
        }
      }

      // 5. Disable apps that are no longer in the cluster
      for (const existing of existingApps) {
        if (!clusterSlugs.has(existing.slug) && existing.enabled) {
          yield* appRepo
            .update(existing.id, { enabled: false })
            .pipe(
              Effect.mapError(
                (e: ApplicationRepoError) =>
                  new AppSyncError({ message: `Failed to disable app ${existing.slug}`, cause: e }),
              ),
            )
          disabled++
        }
      }

      return { created, updated, disabled, total: clusterApps.length } satisfies SyncResult
    }),
})
