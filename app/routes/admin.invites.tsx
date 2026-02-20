import { useEffect, useRef } from "react"
import { useFetcher, useRevalidator } from "react-router"
import { useTranslation } from "react-i18next"
import type { Route } from "./+types/admin.invites"
import { runEffect } from "~/lib/runtime.server"
import { UserManager } from "~/lib/services/UserManager.server"
import { config } from "~/lib/config.server"
import { InviteRepo, type Invite } from "~/lib/services/InviteRepo.server"
import { queueInvite, revokeInvite } from "~/lib/workflows/invite.server"
import { Effect } from "effect"
import { supportedLngs } from "~/lib/i18n"
import { Alert } from "~/components/Alert/Alert"
import { CardSection } from "~/components/CardSection/CardSection"
import s from "./admin.shared.module.css"
import inv from "./admin.invites.module.css"

const languageNames: Record<string, string> = {
  en: "English",
  fr: "Francais",
}

export async function loader() {
  const [groups, pendingInvites, failedInvites] = await Promise.all([
    runEffect(
      Effect.gen(function* () {
        const users = yield* UserManager
        return yield* users.getGroups
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        return yield* repo.findPending()
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        return yield* repo.findFailed()
      }),
    ),
  ])

  return { groups, pendingInvites, failedInvites }
}

export async function action({ request }: Route.ActionArgs) {
  const origin = request.headers.get("Origin")
  if (origin && !origin.endsWith(config.allowedOriginSuffix)) {
    throw new Response("Invalid origin", { status: 403 })
  }

  const formData = await request.formData()
  const intent = formData.get("intent") as string

  if (intent === "revoke") {
    const inviteId = formData.get("inviteId") as string
    if (!inviteId) return { error: "Missing invite ID" }
    try {
      await runEffect(revokeInvite(inviteId))
      return { success: true, message: "Invite revoked" }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to revoke invite"
      return { error: message }
    }
  }

  if (intent === "retry") {
    const inviteId = formData.get("inviteId") as string
    if (!inviteId) return { error: "Missing invite ID" }
    try {
      const result = await runEffect(
        Effect.gen(function* () {
          const repo = yield* InviteRepo
          const invite = yield* repo.findById(inviteId)
          if (!invite) return { error: "Invite not found" as const }
          yield* repo.revoke(inviteId)

          return yield* queueInvite({
            email: invite.email,
            groups: JSON.parse(invite.groups) as number[],
            groupNames: JSON.parse(invite.groupNames) as string[],
            invitedBy: invite.invitedBy,
            locale: invite.locale,
          })
        }),
      )
      return result
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to retry invite"
      return { error: message }
    }
  }

  if (intent === "resend") {
    const inviteId = formData.get("inviteId") as string
    if (!inviteId) return { error: "Missing invite ID" }
    try {
      const result = await runEffect(
        Effect.gen(function* () {
          const repo = yield* InviteRepo
          const invite = yield* repo.findById(inviteId)
          if (!invite) return { error: "Invite not found" as const }
          yield* repo.revoke(inviteId)

          return yield* queueInvite({
            email: invite.email,
            groups: JSON.parse(invite.groups) as number[],
            groupNames: JSON.parse(invite.groupNames) as string[],
            invitedBy: invite.invitedBy,
            locale: invite.locale,
          })
        }),
      )
      return result
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to resend invite"
      return { error: message }
    }
  }

  // Default: send new invite
  const email = formData.get("email") as string
  const selectedGroups = formData.getAll("groups") as string[]
  const locale = (formData.get("locale") as string) || "en"
  const confirmed = formData.get("confirmed") as string

  if (!email || !email.includes("@")) {
    return { error: "Valid email is required" }
  }
  if (selectedGroups.length === 0) {
    return { error: "Select at least one group" }
  }

  try {
    // Check for previous revocation
    if (confirmed !== "true") {
      const revocation = await runEffect(
        Effect.gen(function* () {
          const repo = yield* InviteRepo
          return yield* repo.findRevocationByEmail(email)
        }),
      )
      if (revocation) {
        return {
          warning: `This email was previously revoked by ${revocation.revokedBy}${revocation.reason ? ` (reason: ${revocation.reason})` : ""}. Proceed anyway?`,
          revocationId: revocation.id,
          email,
          groups: selectedGroups,
        }
      }
    }

    // Clear revocation if confirmed
    const revocationId = formData.get("revocationId") as string
    if (confirmed === "true" && revocationId) {
      await runEffect(
        Effect.gen(function* () {
          const repo = yield* InviteRepo
          yield* repo.deleteRevocation(revocationId)
        }),
      )
    }

    const groupIds = selectedGroups.map((g) => {
      const [id] = g.split("|")
      return parseInt(id, 10)
    })
    const groupNames = selectedGroups.map((g) => {
      const [, name] = g.split("|")
      return name
    })

    const result = await runEffect(
      queueInvite({
        email,
        groups: groupIds,
        groupNames,
        invitedBy: "admin",
        locale,
      }),
    )
    return result
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to send invite"
    return { error: message }
  }
}

function StepBadges({ invite }: { invite: Invite }) {
  const { t } = useTranslation()
  if (invite.failedAt) return <span className={`${s.badge} ${s.badgeError}`}>{t("admin.invites.badge.failed")}</span>
  if (invite.emailSent) return <span className={`${s.badge} ${s.badgeSuccess}`}>{t("admin.invites.badge.sent")}</span>
  if (invite.certIssued) return <span className={`${s.badge} ${s.badgeDone}`}>{t("admin.invites.badge.certIssued")}</span>
  return <span className={`${s.badge} ${s.badgePending}`}>{t("admin.invites.badge.processing")}</span>
}

export default function AdminInvitesPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const { groups, pendingInvites, failedInvites } = loaderData
  const fetcher = useFetcher<typeof action>()
  const formRef = useRef<HTMLFormElement>(null)
  const isSubmitting = fetcher.state !== "idle"
  const revalidator = useRevalidator()

  useEffect(() => {
    if (fetcher.data && "success" in fetcher.data && fetcher.data.success) {
      formRef.current?.reset()
    }
  }, [fetcher.data])

  // Auto-refresh while invites are still processing
  useEffect(() => {
    const hasIncomplete = pendingInvites.some((i) => !i.emailSent)
    if (!hasIncomplete) return

    const interval = setInterval(() => {
      if (revalidator.state === "idle") {
        revalidator.revalidate()
      }
    }, 5000)

    return () => clearInterval(interval)
  }, [pendingInvites, revalidator])

  const actionData = fetcher.data
  const hasRevocationWarning = actionData && "warning" in actionData && "groups" in actionData

  return (
    <>
      {/* Invite Form */}
      <CardSection title={t("admin.invites.sendTitle")}>
        {actionData && "error" in actionData && (
          <Alert variant="error">{actionData.error}</Alert>
        )}
        {actionData && "success" in actionData && actionData.success && (
          <Alert variant="success">{actionData.message}</Alert>
        )}
        {hasRevocationWarning && (
          <Alert variant="warning">
            <p>{actionData.warning}</p>
            <fetcher.Form method="post" style={{ marginTop: "0.5rem" }}>
              <input type="hidden" name="email" value={actionData.email} />
              <input type="hidden" name="confirmed" value="true" />
              <input type="hidden" name="revocationId" value={actionData.revocationId} />
              {(actionData.groups as string[]).map((g) => (
                <input key={g} type="hidden" name="groups" value={g} />
              ))}
              <button type="submit" className={`${s.btn} ${s.btnPrimary}`}>
                {t("admin.invites.proceedAnyway")}
              </button>
            </fetcher.Form>
          </Alert>
        )}

        <fetcher.Form method="post" ref={formRef}>
          <div className={inv.formGroup}>
            <label htmlFor="email">{t("admin.invites.emailLabel")}</label>
            <input
              id="email"
              name="email"
              type="email"
              required
              placeholder={t("admin.invites.emailPlaceholder")}
              className={s.input}
            />
          </div>

          <div className={inv.formGroup}>
            <label>{t("admin.invites.groupsLabel")}</label>
            <div className={inv.checkboxGrid}>
              {groups.map((g) => (
                <label key={g.id} className={inv.checkboxLabel}>
                  <input type="checkbox" name="groups" value={`${g.id}|${g.displayName}`} />
                  <span>{g.displayName}</span>
                </label>
              ))}
            </div>
          </div>

          <div className={inv.formGroup}>
            <label htmlFor="locale">{t("admin.invites.languageLabel")}</label>
            <select id="locale" name="locale" defaultValue="en" className={s.input} style={{ width: "auto" }}>
              {supportedLngs.map((lng) => (
                <option key={lng} value={lng}>
                  {languageNames[lng] ?? lng}
                </option>
              ))}
            </select>
          </div>

          <button type="submit" className={`${s.btn} ${s.btnPrimary}`} disabled={isSubmitting}>
            {isSubmitting ? t("admin.invites.submitting") : t("admin.invites.submit")}
          </button>
        </fetcher.Form>
      </CardSection>

      {/* Failed Invites */}
      {failedInvites.length > 0 && (
        <CardSection title={`${t("admin.invites.failedTitle")} (${failedInvites.length})`}>
          <div className={s.tableContainer}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>{t("admin.invites.cols.email")}</th>
                  <th>{t("admin.invites.cols.error")}</th>
                  <th>{t("admin.invites.cols.failedAt")}</th>
                  <th>{t("admin.invites.cols.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {failedInvites.map((i) => (
                  <FailedInviteRow key={i.id} invite={i} />
                ))}
              </tbody>
            </table>
          </div>
        </CardSection>
      )}

      {/* Active Invites */}
      <CardSection title={`${t("admin.invites.activeTitle")} (${pendingInvites.length})`}>
        {pendingInvites.length === 0 ? (
          <p className={s.emptyState}>{t("admin.invites.noActive")}</p>
        ) : (
          <div className={s.tableContainer}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>{t("admin.invites.cols.email")}</th>
                  <th>{t("admin.invites.cols.groups")}</th>
                  <th>{t("admin.invites.cols.status")}</th>
                  <th>{t("admin.invites.cols.invitedBy")}</th>
                  <th>{t("admin.invites.cols.expires")}</th>
                  <th>{t("admin.invites.cols.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {pendingInvites.map((i) => (
                  <PendingInviteRow key={i.id} invite={i} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardSection>
    </>
  )
}

function PendingInviteRow({ invite }: { invite: Invite }) {
  const { t } = useTranslation()
  const revokeFetcher = useFetcher()
  const resendFetcher = useFetcher()
  const isRevoking = revokeFetcher.state !== "idle"
  const isResending = resendFetcher.state !== "idle"

  return (
    <tr>
      <td>{invite.email}</td>
      <td>{JSON.parse(invite.groupNames).join(", ")}</td>
      <td>
        <StepBadges invite={invite} />
      </td>
      <td>{invite.invitedBy}</td>
      <td>{new Date(invite.expiresAt).toLocaleDateString()}</td>
      <td>
        <div className={s.actionBtns}>
          <resendFetcher.Form method="post">
            <input type="hidden" name="intent" value="resend" />
            <input type="hidden" name="inviteId" value={invite.id} />
            <button type="submit" className={s.btnGhost} disabled={isResending || isRevoking}>
              {isResending ? t("admin.invites.action.resending") : t("admin.invites.action.resend")}
            </button>
          </resendFetcher.Form>
          <revokeFetcher.Form method="post">
            <input type="hidden" name="intent" value="revoke" />
            <input type="hidden" name="inviteId" value={invite.id} />
            <button
              type="submit"
              className={`${s.btnGhost} ${s.btnGhostDanger}`}
              disabled={isRevoking || isResending}
            >
              {isRevoking ? t("admin.invites.action.revoking") : t("admin.invites.action.revoke")}
            </button>
          </revokeFetcher.Form>
        </div>
      </td>
    </tr>
  )
}

function FailedInviteRow({ invite }: { invite: Invite }) {
  const { t } = useTranslation()
  const retryFetcher = useFetcher()
  const revokeFetcher = useFetcher()
  const isRetrying = retryFetcher.state !== "idle"
  const isRevoking = revokeFetcher.state !== "idle"

  return (
    <tr>
      <td>{invite.email}</td>
      <td className={inv.errorText}>{invite.lastError ?? "Unknown error"}</td>
      <td>{invite.failedAt ? new Date(invite.failedAt).toLocaleString() : "\u2014"}</td>
      <td>
        <div className={s.actionBtns}>
          <retryFetcher.Form method="post">
            <input type="hidden" name="intent" value="retry" />
            <input type="hidden" name="inviteId" value={invite.id} />
            <button type="submit" className={s.btnGhost} disabled={isRetrying || isRevoking}>
              {isRetrying ? t("admin.invites.action.retrying") : t("admin.invites.action.retry")}
            </button>
          </retryFetcher.Form>
          <revokeFetcher.Form method="post">
            <input type="hidden" name="intent" value="revoke" />
            <input type="hidden" name="inviteId" value={invite.id} />
            <button
              type="submit"
              className={`${s.btnGhost} ${s.btnGhostDanger}`}
              disabled={isRevoking || isRetrying}
            >
              {isRevoking ? t("admin.invites.action.revoking") : t("admin.invites.action.revoke")}
            </button>
          </revokeFetcher.Form>
        </div>
      </td>
    </tr>
  )
}
