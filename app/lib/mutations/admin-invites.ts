import { Effect } from "effect"
import { InviteRepo } from "~/lib/services/InviteRepo.server"
import { queueInvite, revokeInvite } from "~/lib/workflows/invite.server"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdminInvitesMutation =
  | { intent: "revoke"; inviteId: string }
  | { intent: "retry"; inviteId: string }
  | { intent: "resend"; inviteId: string }
  | {
      intent: "send"
      email: string
      groups: string[]
      locale: string
      confirmed: boolean
      revocationId?: string
    }

export type AdminInvitesResult =
  | { success: true; message: string }
  | { error: string }
  | {
      warning: string
      revocationId: string
      email: string
      groups: string[]
    }

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function handleAdminInvitesMutation(mutation: AdminInvitesMutation) {
  return Effect.gen(function* () {
    switch (mutation.intent) {
      case "revoke": {
        yield* revokeInvite(mutation.inviteId)
        return { success: true as const, message: "Invite revoked" }
      }

      case "retry":
      case "resend": {
        const repo = yield* InviteRepo
        const invite = yield* repo.findById(mutation.inviteId)
        if (!invite) return { error: "Invite not found" } as AdminInvitesResult
        yield* repo.revoke(mutation.inviteId)

        const result = yield* queueInvite({
          email: invite.email,
          groups: JSON.parse(invite.groups) as number[],
          groupNames: JSON.parse(invite.groupNames) as string[],
          invitedBy: invite.invitedBy,
          locale: invite.locale,
        })
        return result as AdminInvitesResult
      }

      case "send": {
        const repo = yield* InviteRepo

        // Check for previous revocation
        if (!mutation.confirmed) {
          const revocation = yield* repo.findRevocationByEmail(mutation.email)
          if (revocation) {
            return {
              warning: `This email was previously revoked by ${revocation.revokedBy}${revocation.reason ? ` (reason: ${revocation.reason})` : ""}. Proceed anyway?`,
              revocationId: revocation.id,
              email: mutation.email,
              groups: mutation.groups,
            } as AdminInvitesResult
          }
        }

        // Clear revocation if confirmed
        if (mutation.confirmed && mutation.revocationId) {
          yield* repo.deleteRevocation(mutation.revocationId)
        }

        const groupIds = mutation.groups.map((g) => {
          const [id] = g.split("|")
          return parseInt(id, 10)
        })
        const groupNames = mutation.groups.map((g) => {
          const [, name] = g.split("|")
          return name
        })

        const result = yield* queueInvite({
          email: mutation.email,
          groups: groupIds,
          groupNames,
          invitedBy: "admin",
          locale: mutation.locale,
        })
        return result as AdminInvitesResult
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
      return Effect.succeed({ error: message } as AdminInvitesResult)
    }),
  )
}

// ---------------------------------------------------------------------------
// FormData parser
// ---------------------------------------------------------------------------

export function parseAdminInvitesMutation(formData: FormData): AdminInvitesMutation | { error: string } {
  const intent = formData.get("intent") as string | null

  if (intent === "revoke") {
    const inviteId = formData.get("inviteId") as string
    if (!inviteId) return { error: "Missing invite ID" }
    return { intent, inviteId }
  }
  if (intent === "retry" || intent === "resend") {
    const inviteId = formData.get("inviteId") as string
    if (!inviteId) return { error: "Missing invite ID" }
    return { intent, inviteId }
  }

  // Default: send new invite
  const email = formData.get("email") as string
  const groups = formData.getAll("groups") as string[]
  const locale = (formData.get("locale") as string) || "en"
  const confirmed = formData.get("confirmed") === "true"
  const revocationId = (formData.get("revocationId") as string) || undefined

  if (!email || !email.includes("@")) {
    return { error: "Valid email is required" }
  }
  if (groups.length === 0) {
    return { error: "Select at least one group" }
  }

  return { intent: "send", email, groups, locale, confirmed, revocationId }
}
