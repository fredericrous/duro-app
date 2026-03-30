import { Effect } from "effect"
import { ApplicationRepo } from "~/lib/governance/ApplicationRepo.server"
import { RbacRepo } from "~/lib/governance/RbacRepo.server"
import { AppSyncService } from "~/lib/governance/AppSyncService.server"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdminApplicationsMutation =
  | { intent: "syncFromCluster" }
  | { intent: "update"; id: string; displayName?: string; description?: string; accessMode?: string; enabled?: boolean; ownerId?: string }
  | { intent: "delete"; id: string }
  | { intent: "createRole"; applicationId: string; slug: string; displayName: string; description?: string }
  | { intent: "createEntitlement"; applicationId: string; slug: string; displayName: string; description?: string }

export type AdminApplicationsResult = { success: true; message: string } | { error: string }

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function handleAdminApplicationsMutation(mutation: AdminApplicationsMutation) {
  return Effect.gen(function* () {
    switch (mutation.intent) {
      case "syncFromCluster": {
        const syncService = yield* AppSyncService
        const result = yield* syncService.syncFromCluster()
        return {
          success: true as const,
          message: `Synced ${result.total} apps: ${result.created} created, ${result.updated} updated, ${result.disabled} disabled`,
        }
      }

      case "update": {
        const repo = yield* ApplicationRepo
        const fields: Record<string, unknown> = {}
        if (mutation.displayName !== undefined) fields.displayName = mutation.displayName
        if (mutation.description !== undefined) fields.description = mutation.description
        if (mutation.accessMode !== undefined) fields.accessMode = mutation.accessMode
        if (mutation.enabled !== undefined) fields.enabled = mutation.enabled
        if (mutation.ownerId !== undefined) fields.ownerId = mutation.ownerId
        yield* repo.update(mutation.id, fields)
        return { success: true as const, message: "Application updated" }
      }

      case "delete": {
        yield* Effect.log(`[admin-applications] delete requested for id=${mutation.id} (not implemented)`)
        return { success: true as const, message: "Delete not implemented yet" }
      }

      case "createRole": {
        const rbac = yield* RbacRepo
        const role = yield* rbac.createRole(
          mutation.applicationId,
          mutation.slug,
          mutation.displayName,
          mutation.description,
        )
        return { success: true as const, message: `Role "${role.displayName}" created` }
      }

      case "createEntitlement": {
        const rbac = yield* RbacRepo
        const ent = yield* rbac.createEntitlement(
          mutation.applicationId,
          mutation.slug,
          mutation.displayName,
          mutation.description,
        )
        return { success: true as const, message: `Entitlement "${ent.displayName}" created` }
      }
    }
  }).pipe(
    Effect.catchAll((e) => {
      const message =
        e instanceof Error
          ? e.message
          : typeof e === "object" && e !== null && "message" in e
            ? String((e as any).message)
            : "Operation failed"
      return Effect.succeed({ error: message } as AdminApplicationsResult)
    }),
  )
}

// ---------------------------------------------------------------------------
// FormData parser
// ---------------------------------------------------------------------------

export function parseAdminApplicationsMutation(formData: FormData): AdminApplicationsMutation | { error: string } {
  const intent = formData.get("intent") as string

  switch (intent) {
    case "syncFromCluster": {
      return { intent }
    }

    case "update": {
      const id = formData.get("id") as string
      if (!id) return { error: "Missing application id" }
      const displayName = (formData.get("displayName") as string) || undefined
      const description = (formData.get("description") as string) || undefined
      const accessMode = (formData.get("accessMode") as string) || undefined
      const enabledRaw = formData.get("enabled") as string | null
      const enabled = enabledRaw !== null ? enabledRaw === "true" : undefined
      const ownerId = (formData.get("ownerId") as string) || undefined
      return { intent, id, displayName, description, accessMode, enabled, ownerId }
    }

    case "delete": {
      const id = formData.get("id") as string
      if (!id) return { error: "Missing application id" }
      return { intent, id }
    }

    case "createRole": {
      const applicationId = formData.get("applicationId") as string
      const slug = formData.get("slug") as string
      const displayName = formData.get("displayName") as string
      if (!applicationId || !slug || !displayName) {
        return { error: "Missing applicationId, slug, or displayName" }
      }
      const description = (formData.get("description") as string) || undefined
      return { intent, applicationId, slug, displayName, description }
    }

    case "createEntitlement": {
      const applicationId = formData.get("applicationId") as string
      const slug = formData.get("slug") as string
      const displayName = formData.get("displayName") as string
      if (!applicationId || !slug || !displayName) {
        return { error: "Missing applicationId, slug, or displayName" }
      }
      const description = (formData.get("description") as string) || undefined
      return { intent, applicationId, slug, displayName, description }
    }

    default:
      return { error: "Unknown action" }
  }
}
