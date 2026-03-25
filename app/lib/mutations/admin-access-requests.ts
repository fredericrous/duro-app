import { Effect } from "effect"
import { AccessRequestRepo } from "~/lib/governance/AccessRequestRepo.server"
import { decideApproval } from "~/lib/workflows/access-request.server"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdminAccessRequestsMutation =
  | { intent: "approve"; requestId: string; approverId: string; comment?: string }
  | { intent: "reject"; requestId: string; approverId: string; comment?: string }
  | { intent: "cancel"; requestId: string }

export type AdminAccessRequestsResult =
  | { success: true; message: string }
  | { error: string }

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function handleAdminAccessRequestsMutation(mutation: AdminAccessRequestsMutation) {
  return Effect.gen(function* () {
    switch (mutation.intent) {
      case "approve": {
        yield* decideApproval({
          requestId: mutation.requestId,
          approverId: mutation.approverId,
          decision: "approved",
          comment: mutation.comment,
        })
        return { success: true as const, message: "Access request approved" }
      }

      case "reject": {
        yield* decideApproval({
          requestId: mutation.requestId,
          approverId: mutation.approverId,
          decision: "rejected",
          comment: mutation.comment,
        })
        return { success: true as const, message: "Access request rejected" }
      }

      case "cancel": {
        const repo = yield* AccessRequestRepo
        yield* repo.updateStatus(mutation.requestId, "cancelled")
        return { success: true as const, message: "Access request cancelled" }
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
      return Effect.succeed({ error: message } as AdminAccessRequestsResult)
    }),
  )
}

// ---------------------------------------------------------------------------
// FormData parser
// ---------------------------------------------------------------------------

export function parseAdminAccessRequestsMutation(
  formData: FormData,
): AdminAccessRequestsMutation | { error: string } {
  const intent = formData.get("intent") as string

  switch (intent) {
    case "approve": {
      const requestId = formData.get("requestId") as string
      const approverId = formData.get("approverId") as string
      if (!requestId || !approverId) return { error: "Missing requestId or approverId" }
      const comment = (formData.get("comment") as string) || undefined
      return { intent, requestId, approverId, comment }
    }

    case "reject": {
      const requestId = formData.get("requestId") as string
      const approverId = formData.get("approverId") as string
      if (!requestId || !approverId) return { error: "Missing requestId or approverId" }
      const comment = (formData.get("comment") as string) || undefined
      return { intent, requestId, approverId, comment }
    }

    case "cancel": {
      const requestId = formData.get("requestId") as string
      if (!requestId) return { error: "Missing requestId" }
      return { intent, requestId }
    }

    default:
      return { error: "Unknown action" }
  }
}
