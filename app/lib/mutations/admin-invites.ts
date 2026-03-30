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
      emails: string[]
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
      emails: string[]
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

        // Check for previous revocations (only for single email)
        if (!mutation.confirmed && mutation.emails.length === 1) {
          const revocation = yield* repo.findRevocationByEmail(mutation.emails[0])
          if (revocation) {
            return {
              warning: `This email was previously revoked by ${revocation.revokedBy}${revocation.reason ? ` (reason: ${revocation.reason})` : ""}. Proceed anyway?`,
              revocationId: revocation.id,
              emails: mutation.emails,
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

        const errors: string[] = []
        let sent = 0

        for (const email of mutation.emails) {
          yield* queueInvite({
            email,
            groups: groupIds,
            groupNames,
            invitedBy: "admin",
            locale: mutation.locale,
          }).pipe(
            Effect.tap(() => {
              sent++
              return Effect.void
            }),
            Effect.catchAll((e) => {
              const msg =
                e instanceof Error
                  ? e.message
                  : typeof e === "object" && e !== null && "message" in e
                    ? String((e as any).message)
                    : "Unknown error"
              errors.push(`${email}: ${msg}`)
              return Effect.void
            }),
          )
        }

        if (sent === 0) {
          return { error: errors.join("\n") } as AdminInvitesResult
        }

        const message =
          errors.length > 0
            ? `Sent ${sent} of ${mutation.emails.length} invites. Errors:\n${errors.join("\n")}`
            : sent === 1
              ? `Invite sent to ${mutation.emails[0]}`
              : `${sent} invites sent`

        return { success: true as const, message }
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
// Helpers
// ---------------------------------------------------------------------------

function parseEmails(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0 && e.includes("@"))
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

  // Default: send new invite(s)
  const allEmails = formData.getAll("emails") as string[]
  const groups = formData.getAll("groups") as string[]
  const locale = (formData.get("locale") as string) || "en"
  const confirmed = formData.get("confirmed") === "true"
  const revocationId = (formData.get("revocationId") as string) || undefined

  // Support both hidden inputs (one per email) and legacy single-string format
  const emails =
    allEmails.length === 1
      ? parseEmails(allEmails[0])
      : allEmails.map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"))
  if (emails.length === 0) {
    return { error: "At least one valid email is required" }
  }
  if (groups.length === 0) {
    return { error: "Select at least one group" }
  }

  return { intent: "send", emails, groups, locale, confirmed, revocationId }
}
