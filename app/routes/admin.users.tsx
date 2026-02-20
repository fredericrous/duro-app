import { useState } from "react"
import { useFetcher } from "react-router"
import { useTranslation } from "react-i18next"
import type { Route } from "./+types/admin.users"
import { runEffect } from "~/lib/runtime.server"
import { UserManager } from "~/lib/services/UserManager.server"
import { config } from "~/lib/config.server"
import { InviteRepo, type Revocation } from "~/lib/services/InviteRepo.server"
import { revokeUser, resendCert } from "~/lib/workflows/invite.server"
import { Effect } from "effect"
import { CardSection } from "~/components/CardSection/CardSection"
import s from "./admin.shared.module.css"
import u from "./admin.users.module.css"

export async function loader() {
  const [users, revocations] = await Promise.all([
    runEffect(
      Effect.gen(function* () {
        const um = yield* UserManager
        return yield* um.getUsers
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        return yield* repo.findRevocations()
      }),
    ),
  ])

  return { users, revocations, systemUsers: config.systemUsers }
}

export async function action({ request }: Route.ActionArgs) {
  const origin = request.headers.get("Origin")
  if (origin && !origin.endsWith(config.allowedOriginSuffix)) {
    throw new Response("Invalid origin", { status: 403 })
  }

  const formData = await request.formData()
  const intent = formData.get("intent") as string

  if (intent === "revokeUser") {
    const username = formData.get("username") as string
    const email = formData.get("email") as string
    const reason = (formData.get("reason") as string) || undefined
    if (!username || !email) return { error: "Missing username or email" }
    try {
      await runEffect(revokeUser(username, email, "admin", reason))
      return { success: true, message: `User ${username} revoked` }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to revoke user"
      return { error: message }
    }
  }

  if (intent === "resendCert") {
    const username = formData.get("username") as string
    const email = formData.get("email") as string
    if (!username || !email) return { error: "Missing username or email" }
    try {
      const result = await runEffect(resendCert(email, username))
      return result
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to send certificate"
      return { error: message }
    }
  }

  if (intent === "reinviteRevoked") {
    const revocationId = formData.get("revocationId") as string
    if (!revocationId) return { error: "Missing revocation ID" }
    try {
      const revocation = await runEffect(
        Effect.gen(function* () {
          const repo = yield* InviteRepo
          const revocations = yield* repo.findRevocations()
          return revocations.find((r) => r.id === revocationId) ?? null
        }),
      )
      if (!revocation) return { error: "Revocation not found" }
      await runEffect(
        Effect.gen(function* () {
          const repo = yield* InviteRepo
          yield* repo.deleteRevocation(revocationId)
        }),
      )
      return {
        success: true,
        message: `Revocation cleared for ${revocation.email}. You can now re-invite them.`,
        reinviteEmail: revocation.email,
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to clear revocation"
      return { error: message }
    }
  }

  return { error: "Unknown action" }
}

export default function AdminUsersPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const { users, revocations, systemUsers } = loaderData

  return (
    <>
      {/* Users List */}
      <CardSection title={`${t("admin.users.title")} (${users.length})`}>
        <div className={s.tableContainer}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>{t("admin.users.cols.username")}</th>
                <th>{t("admin.users.cols.displayName")}</th>
                <th>{t("admin.users.cols.email")}</th>
                <th>{t("admin.users.cols.created")}</th>
                <th>{t("admin.users.cols.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <UserRow key={user.id} user={user} isSystem={systemUsers.includes(user.id)} />
              ))}
            </tbody>
          </table>
        </div>
      </CardSection>

      {/* Revoked Users */}
      {revocations.length > 0 && (
        <CardSection title={`${t("admin.users.revokedTitle")} (${revocations.length})`}>
          <div className={s.tableContainer}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>{t("admin.users.cols.email")}</th>
                  <th>{t("admin.users.cols.username")}</th>
                  <th>{t("admin.users.cols.reason")}</th>
                  <th>{t("admin.users.cols.revoked")}</th>
                  <th>{t("admin.users.cols.by")}</th>
                  <th>{t("admin.users.cols.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {revocations.map((r) => (
                  <RevokedUserRow key={r.id} revocation={r} />
                ))}
              </tbody>
            </table>
          </div>
        </CardSection>
      )}
    </>
  )
}

function UserRow({
  user,
  isSystem,
}: {
  user: { id: string; displayName: string; email: string; creationDate: string }
  isSystem: boolean
}) {
  const { t } = useTranslation()
  const [showRevoke, setShowRevoke] = useState(false)
  const certFetcher = useFetcher()
  const revokeFetcher = useFetcher()
  const isSendingCert = certFetcher.state !== "idle"
  const isRevoking = revokeFetcher.state !== "idle"

  const revokeSucceeded = revokeFetcher.data && "success" in revokeFetcher.data
  if (revokeSucceeded && showRevoke) {
    setShowRevoke(false)
  }

  return (
    <>
      <tr>
        <td>{user.id}</td>
        <td>{user.displayName}</td>
        <td>{user.email}</td>
        <td>{new Date(user.creationDate).toLocaleDateString()}</td>
        <td>
          {!isSystem && (
            <div className={s.actionBtns}>
              <certFetcher.Form method="post">
                <input type="hidden" name="intent" value="resendCert" />
                <input type="hidden" name="username" value={user.id} />
                <input type="hidden" name="email" value={user.email} />
                <button type="submit" className={s.btnGhost} disabled={isSendingCert || isRevoking}>
                  {isSendingCert ? t("admin.users.actions.sendingCert") : t("admin.users.actions.sendCert")}
                </button>
              </certFetcher.Form>
              <button
                type="button"
                className={`${s.btnGhost} ${s.btnGhostDanger}`}
                disabled={isRevoking}
                onClick={() => setShowRevoke(!showRevoke)}
              >
                {t("admin.users.actions.revoke")}
              </button>
            </div>
          )}
        </td>
      </tr>
      {showRevoke && (
        <tr>
          <td colSpan={5}>
            <revokeFetcher.Form method="post" className={u.inlineRevokeForm}>
              <input type="hidden" name="intent" value="revokeUser" />
              <input type="hidden" name="username" value={user.id} />
              <input type="hidden" name="email" value={user.email} />
              <input
                name="reason"
                type="text"
                placeholder={t("admin.users.actions.reasonPlaceholder")}
                className={s.input}
                style={{ flex: 1 }}
              />
              <button type="submit" className={`${s.btn} ${s.btnDanger}`} disabled={isRevoking}>
                {isRevoking ? t("admin.users.actions.revoking") : t("admin.users.actions.confirmRevoke")}
              </button>
              <button type="button" className={s.btnGhost} onClick={() => setShowRevoke(false)}>
                {t("common.cancel")}
              </button>
            </revokeFetcher.Form>
          </td>
        </tr>
      )}
    </>
  )
}

function RevokedUserRow({ revocation }: { revocation: Revocation }) {
  const { t } = useTranslation()
  const fetcher = useFetcher()
  const isSubmitting = fetcher.state !== "idle"

  return (
    <tr>
      <td>{revocation.email}</td>
      <td>{revocation.username}</td>
      <td>{revocation.reason ?? "\u2014"}</td>
      <td>{new Date(revocation.revokedAt).toLocaleDateString()}</td>
      <td>{revocation.revokedBy}</td>
      <td>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="reinviteRevoked" />
          <input type="hidden" name="revocationId" value={revocation.id} />
          <button type="submit" className={s.btnGhost} disabled={isSubmitting}>
            {isSubmitting ? t("admin.users.actions.processing") : t("admin.users.actions.reinvite")}
          </button>
        </fetcher.Form>
      </td>
    </tr>
  )
}
