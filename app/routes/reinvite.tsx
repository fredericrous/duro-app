import { useState } from "react"
import { useNavigation } from "react-router"
import type { Route } from "./+types/reinvite"
import { runEffect } from "~/lib/runtime.server"
import { InviteRepo } from "~/lib/services/InviteRepo.server"
import { VaultPki } from "~/lib/services/VaultPki.server"
import { queueInvite } from "~/lib/workflows/invite.server"
import { hashToken } from "~/lib/crypto.server"
import { Effect } from "effect"
import { Button } from "@base-ui/react/button"
import shared from "./shared.module.css"
import local from "./reinvite.module.css"

export function meta() {
  return [{ title: "Request New Invite - Daddyshome" }]
}

export async function loader({ params }: Route.LoaderArgs) {
  const token = params.token
  if (!token) {
    return { canReinvite: false as const, error: "Missing token" }
  }

  try {
    const tokenHash = hashToken(token)

    return await runEffect(
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const vault = yield* VaultPki

        const invite = yield* repo.findByTokenHash(tokenHash)
        if (!invite) {
          return { canReinvite: false as const, error: "Invalid link" }
        }

        // If account was already created, no re-invite
        if (invite.usedBy && invite.usedBy !== "__revoked__") {
          return {
            canReinvite: false as const,
            error: "This invite has already been used to create an account. If you need help, contact the person who invited you.",
          }
        }

        // Only allow re-invite if expired or password already consumed
        const isExpired = new Date(invite.expiresAt + "Z") < new Date()
        const pw = yield* vault.getP12Password(invite.id)
        const passwordConsumed = pw === null

        if (!isExpired && !passwordConsumed) {
          return {
            canReinvite: false as const,
            error: "Your invite is still valid. Check your email for the original invitation link.",
          }
        }

        return {
          canReinvite: true as const,
          email: invite.email,
        }
      }),
    )
  } catch {
    return { canReinvite: false as const, error: "Something went wrong" }
  }
}

export async function action({ params }: Route.ActionArgs) {
  const token = params.token
  if (!token) {
    return { success: false as const, error: "Missing token" }
  }

  try {
    const tokenHash = hashToken(token)

    const result = await runEffect(
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const vault = yield* VaultPki

        const invite = yield* repo.findByTokenHash(tokenHash)
        if (!invite) {
          return { success: false as const, error: "Invalid link" }
        }

        if (invite.usedBy && invite.usedBy !== "__revoked__") {
          return { success: false as const, error: "Account already created" }
        }

        // Revoke old invite
        yield* repo.revoke(invite.id).pipe(Effect.catchAll(() => Effect.void))

        // Clean up old Vault secret
        yield* vault.deleteP12Secret(invite.id)

        // Queue new invite with same details
        const groups = JSON.parse(invite.groups) as number[]
        const groupNames = JSON.parse(invite.groupNames) as string[]

        yield* queueInvite({
          email: invite.email,
          groups,
          groupNames,
          invitedBy: invite.invitedBy,
        })

        return { success: true as const, email: invite.email }
      }),
    )

    return result
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to send new invite"
    return { success: false as const, error: message }
  }
}

export default function ReinvitePage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const navigation = useNavigation()
  const isSubmitting = navigation.state === "submitting"

  if (actionData && "success" in actionData && actionData.success) {
    return (
      <main className={shared.page}>
        <div className={shared.card}>
          <div className={shared.successIcon}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="48" height="48">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <h1>New Invite Sent</h1>
          <p className={local.infoText}>
            A new invitation email has been sent to{" "}
            <strong>{actionData.email}</strong>. Check your inbox for the new
            link and certificate.
          </p>
        </div>
      </main>
    )
  }

  if (!loaderData.canReinvite) {
    return (
      <main className={shared.page}>
        <div className={shared.card}>
          <div className={shared.errorIcon}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="48" height="48">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <h1>Cannot Re-invite</h1>
          <p className={local.infoText}>
            {loaderData.error}
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className={shared.page}>
      <div className={shared.card}>
        <h1>Request New Invite</h1>
        <p className={local.infoText}>
          Your previous invite for <strong>{loaderData.email}</strong> has
          expired or the certificate password was already revealed. You can
          request a fresh invite below.
        </p>

        {actionData && "error" in actionData && (
          <div className={shared.alertError}>{actionData.error}</div>
        )}

        <form method="post">
          <Button
            type="submit"
            disabled={isSubmitting}
            className={`${shared.btn} ${shared.btnPrimary} ${shared.btnFull}`}
          >
            {isSubmitting ? "Sending..." : "Send Me a New Invite"}
          </Button>
        </form>
      </div>
    </main>
  )
}
