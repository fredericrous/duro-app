import { Effect } from "effect"
import { GrantRepo } from "~/lib/governance/GrantRepo.server"
import { AuditService } from "~/lib/governance/AuditService.server"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdminGrantsMutation = { intent: "revoke"; grantId: string; revokedBy: string }

export type AdminGrantsResult = { success: true; message: string } | { error: string }

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function handleAdminGrantsMutation(mutation: AdminGrantsMutation) {
  return Effect.gen(function* () {
    switch (mutation.intent) {
      case "revoke": {
        const grantRepo = yield* GrantRepo
        const audit = yield* AuditService
        yield* grantRepo.revoke(mutation.grantId, mutation.revokedBy)
        yield* audit.emit({
          eventType: "grant.revoked",
          actorId: mutation.revokedBy,
          targetType: "grant",
          targetId: mutation.grantId,
        })
        return { success: true as const, message: `Grant ${mutation.grantId} revoked` }
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
      return Effect.succeed({ error: message } as AdminGrantsResult)
    }),
  )
}

// ---------------------------------------------------------------------------
// FormData parser
// ---------------------------------------------------------------------------

export function parseAdminGrantsMutation(formData: FormData): AdminGrantsMutation | { error: string } {
  const intent = formData.get("intent") as string

  switch (intent) {
    case "revoke": {
      const grantId = formData.get("grantId") as string
      const revokedBy = formData.get("revokedBy") as string
      if (!grantId || !revokedBy) return { error: "Missing grantId or revokedBy" }
      return { intent, grantId, revokedBy }
    }

    default:
      return { error: "Unknown action" }
  }
}
