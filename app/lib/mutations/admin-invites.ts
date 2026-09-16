import { Effect } from "effect"
import { config } from "~/lib/config.server"
import { errorMessage } from "~/lib/error-message"
import { InviteRepo, type Invite } from "~/lib/services/InviteRepo.server"
import { queueInvite, revokeInvite } from "~/lib/workflows/invite.server"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdminInvitesMutation =
  | { intent: "revoke"; inviteId: string }
  | { intent: "retry"; inviteId: string }
  | { intent: "resend"; inviteId: string }
  /** Hand over an existing pending invite again (QR / copy link): no new token, nothing sent. */
  | { intent: "showLink"; inviteId: string }
  | {
      intent: "send"
      emails: string[]
      groups: string[]
      locale: string
      confirmed: boolean
      revocationId?: string
      /** "email" mails the invite; "link" returns it for the admin to hand over (QR). */
      delivery: "email" | "link"
    }

export type AdminInvitesResult =
  | {
      success: true
      message: string
      /**
       * Present for `delivery: "link"` and `showLink`. The invite token is a
       * bearer secret, so it rides this POST response and nothing else — never
       * an SSR-rendered GET.
       */
      invite?: InviteLink
    }
  | { error: string }
  | {
      warning: string
      revocationId: string
      emails: string[]
      groups: string[]
      delivery: "email" | "link"
    }

export interface InviteLink {
  url: string
  email: string
  expiresAt: string
}

/** The link a recipient scans or opens; the same one the invite email carries. */
const linkFor = (invite: { token: string; email: string; expiresAt: string }): InviteLink => ({
  url: `${config.inviteBaseUrl}/invite/${invite.token}`,
  email: invite.email,
  expiresAt: invite.expiresAt,
})

const isPending = (invite: Invite): boolean =>
  invite.status._tag === "Pending" && new Date(invite.expiresAt) > new Date()

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

      // The admin can show the QR code as often as they like until the person
      // has actually joined: same invite, same token, nothing re-issued.
      case "showLink": {
        const repo = yield* InviteRepo
        const invite = yield* repo.findById(mutation.inviteId)
        if (!invite || !isPending(invite)) return { error: "Invite is no longer pending" } as AdminInvitesResult
        return { success: true as const, message: `Invite ready for ${invite.email}`, invite: linkFor(invite) }
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
              delivery: mutation.delivery,
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

        // A second "Generate a QR code" for an address that is already invited
        // is a request to see the code again, not a second invite: hand the
        // existing link back instead of failing on the pending-invite check.
        if (mutation.delivery === "link") {
          const email = mutation.emails[0]
          const existing = (yield* repo.findPending()).find((i) => i.email === email && isPending(i))
          if (existing) {
            return { success: true as const, message: `Invite ready for ${email}`, invite: linkFor(existing) }
          }
        }

        const errors: string[] = []
        let sent = 0
        let link: InviteLink | undefined

        for (const email of mutation.emails) {
          yield* queueInvite({
            email,
            groups: groupIds,
            groupNames,
            invitedBy: "admin",
            locale: mutation.locale,
            delivery: mutation.delivery,
          }).pipe(
            Effect.tap((invite) => {
              sent++
              if (mutation.delivery === "link") {
                link = linkFor({ token: invite.token, email, expiresAt: invite.expiresAt })
              }
              return Effect.void
            }),
            Effect.catchAll((e) => {
              const msg = errorMessage(e, "Unknown error")
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
            : mutation.delivery === "link"
              ? `Invite ready for ${mutation.emails[0]}`
              : sent === 1
                ? `Invite sent to ${mutation.emails[0]}`
                : `${sent} invites sent`

        return { success: true as const, message, ...(link ? { invite: link } : {}) }
      }
    }
  }).pipe(
    Effect.catchAll((e) => {
      const message = errorMessage(e, "Operation failed")
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
  if (intent === "retry" || intent === "resend" || intent === "showLink") {
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
  const rawDelivery = formData.get("delivery")
  if (rawDelivery !== null && rawDelivery !== "email" && rawDelivery !== "link") {
    return { error: "Unsupported delivery" }
  }
  const delivery = rawDelivery === "link" ? "link" : "email"

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
  // A QR code is scanned by one person, so a link invite addresses exactly one
  // recipient — batching would silently hand everyone the first token.
  if (delivery === "link" && emails.length !== 1) {
    return { error: "A QR code can only be generated for one email at a time" }
  }

  return { intent: "send", emails, groups, locale, confirmed, revocationId, delivery }
}
