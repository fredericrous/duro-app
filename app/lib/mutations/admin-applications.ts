import { Effect } from "effect"
import { ApplicationRepo } from "~/lib/governance/ApplicationRepo.server"
import { RbacRepo } from "~/lib/governance/RbacRepo.server"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdminApplicationsMutation =
  | { intent: "create"; slug: string; displayName: string; description?: string; accessMode?: string }
  | { intent: "update"; id: string; displayName?: string; description?: string; accessMode?: string; enabled?: boolean }
  | { intent: "delete"; id: string }
  | { intent: "createRole"; applicationId: string; slug: string; displayName: string; description?: string }
  | { intent: "createEntitlement"; applicationId: string; slug: string; displayName: string; description?: string }

export type AdminApplicationsResult =
  | { success: true; message: string }
  | { error: string }

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function handleAdminApplicationsMutation(mutation: AdminApplicationsMutation) {
  return Effect.gen(function* () {
    switch (mutation.intent) {
      case "create": {
        const repo = yield* ApplicationRepo
        const app = yield* repo.create({
          slug: mutation.slug,
          displayName: mutation.displayName,
          description: mutation.description,
          accessMode: mutation.accessMode,
        })
        return { success: true as const, message: `Application "${app.displayName}" created` }
      }

      case "update": {
        const repo = yield* ApplicationRepo
        const fields: Record<string, unknown> = {}
        if (mutation.displayName !== undefined) fields.displayName = mutation.displayName
        if (mutation.description !== undefined) fields.description = mutation.description
        if (mutation.accessMode !== undefined) fields.accessMode = mutation.accessMode
        if (mutation.enabled !== undefined) fields.enabled = mutation.enabled
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

export function parseAdminApplicationsMutation(
  formData: FormData,
): AdminApplicationsMutation | { error: string } {
  const intent = formData.get("intent") as string

  switch (intent) {
    case "create": {
      const slug = formData.get("slug") as string
      const displayName = formData.get("displayName") as string
      if (!slug || !displayName) return { error: "Missing slug or displayName" }
      const description = (formData.get("description") as string) || undefined
      const accessMode = (formData.get("accessMode") as string) || undefined
      return { intent, slug, displayName, description, accessMode }
    }

    case "update": {
      const id = formData.get("id") as string
      if (!id) return { error: "Missing application id" }
      const displayName = (formData.get("displayName") as string) || undefined
      const description = (formData.get("description") as string) || undefined
      const accessMode = (formData.get("accessMode") as string) || undefined
      const enabledRaw = formData.get("enabled") as string | null
      const enabled = enabledRaw !== null ? enabledRaw === "true" : undefined
      return { intent, id, displayName, description, accessMode, enabled }
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
