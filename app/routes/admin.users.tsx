import { useEffect, useRef } from "react"
import { useFetcher, useRevalidator } from "react-router"
import type { Route } from "./+types/admin.users"
import { runEffect } from "~/lib/runtime.server"
import { LldapClient } from "~/lib/services/LldapClient.server"
import { InviteRepo, type Invite } from "~/lib/services/InviteRepo.server"
import { queueInvite } from "~/lib/workflows/invite.server"
import { Effect } from "effect"
import styles from "./admin.users.module.css"

export async function loader() {
  const [users, groups, pendingInvites, failedInvites] = await Promise.all([
    runEffect(
      Effect.gen(function* () {
        const lldap = yield* LldapClient
        return yield* lldap.getUsers
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        const lldap = yield* LldapClient
        return yield* lldap.getGroups
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

  return { users, groups, pendingInvites, failedInvites }
}

export async function action({ request }: Route.ActionArgs) {
  // CSRF: verify origin
  const origin = request.headers.get("Origin")
  if (origin && !origin.endsWith("daddyshome.fr")) {
    throw new Response("Invalid origin", { status: 403 })
  }

  const formData = await request.formData()
  const intent = formData.get("intent") as string

  if (intent === "revoke") {
    const inviteId = formData.get("inviteId") as string
    if (!inviteId) return { error: "Missing invite ID" }
    try {
      await runEffect(
        Effect.gen(function* () {
          const repo = yield* InviteRepo
          yield* repo.revoke(inviteId)
        }),
      )
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
      await runEffect(
        Effect.gen(function* () {
          const repo = yield* InviteRepo
          yield* repo.clearReconcileError(inviteId)
        }),
      )
      return { success: true, message: "Invite queued for retry" }
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

  if (!email || !email.includes("@")) {
    return { error: "Valid email is required" }
  }
  if (selectedGroups.length === 0) {
    return { error: "Select at least one group" }
  }

  try {
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
      }),
    )
    return result
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to send invite"
    return { error: message }
  }
}

function StepBadges({ invite }: { invite: Invite }) {
  if (invite.failedAt) return <span className={`${styles.badge} ${styles.badgeError}`}>Failed</span>
  if (invite.emailSent && invite.certVerified) return <span className={`${styles.badge} ${styles.badgeSuccess}`}>Sent</span>
  if (invite.emailSent && !invite.certVerified) return (
    <span className={`${styles.badge} ${styles.badgePending}`} title="Email sent, cert-manager pending">
      Sent (cert pending)
    </span>
  )
  if (invite.prMerged) return <span className={`${styles.badge} ${styles.badgeProgress}`}>Sending email...</span>
  if (invite.prCreated) return <span className={`${styles.badge} ${styles.badgePending}`}>Awaiting PR merge</span>
  if (invite.certIssued) return <span className={`${styles.badge} ${styles.badgeDone}`}>Cert issued</span>
  return <span className={`${styles.badge} ${styles.badgePending}`}>Processing...</span>
}

export default function AdminUsersPage({ loaderData }: Route.ComponentProps) {
  const { users, groups, pendingInvites, failedInvites } = loaderData
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
    const hasIncomplete = pendingInvites.some((inv) => !inv.emailSent || (inv.emailSent && !inv.certVerified))
    if (!hasIncomplete) return

    const interval = setInterval(() => {
      if (revalidator.state === "idle") {
        revalidator.revalidate()
      }
    }, 5000)

    return () => clearInterval(interval)
  }, [pendingInvites, revalidator])

  return (
    <>
      {/* Invite Form */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Send Invite</h2>

        {fetcher.data && "error" in fetcher.data && (
          <div className={`${styles.alert} ${styles.alertError}`}>{fetcher.data.error}</div>
        )}
        {fetcher.data && "success" in fetcher.data && fetcher.data.success && (
          <div className={`${styles.alert} ${styles.alertSuccess}`}>{fetcher.data.message}</div>
        )}

        <fetcher.Form method="post" ref={formRef}>
          <div className={styles.formGroup}>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              required
              placeholder="user@example.com"
              className={styles.input}
            />
          </div>

          <div className={styles.formGroup}>
            <label>Groups</label>
            <div className={styles.checkboxGrid}>
              {groups.map((g) => (
                <label key={g.id} className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    name="groups"
                    value={`${g.id}|${g.displayName}`}
                  />
                  <span>{g.displayName}</span>
                </label>
              ))}
            </div>
          </div>

          <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={isSubmitting}>
            {isSubmitting ? "Sending..." : "Send Invite"}
          </button>
        </fetcher.Form>
      </section>

      {/* Failed Invites */}
      {failedInvites.length > 0 && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Failed Invites ({failedInvites.length})</h2>
          <div className={styles.tableContainer}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Error</th>
                  <th>Failed At</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {failedInvites.map((inv) => (
                  <FailedInviteRow key={inv.id} invite={inv} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Pending Invites */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Pending Invites ({pendingInvites.length})</h2>
        {pendingInvites.length === 0 ? (
          <p className={styles.emptyState}>No pending invites</p>
        ) : (
          <div className={styles.tableContainer}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Groups</th>
                  <th>Status</th>
                  <th>Invited By</th>
                  <th>Expires</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pendingInvites.map((inv) => (
                  <PendingInviteRow key={inv.id} invite={inv} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Users List */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Users ({users.length})</h2>
        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Username</th>
                <th>Display Name</th>
                <th>Email</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.id}</td>
                  <td>{u.displayName}</td>
                  <td>{u.email}</td>
                  <td>
                    {new Date(u.creationDate).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

function PendingInviteRow({ invite }: { invite: Invite }) {
  const revokeFetcher = useFetcher()
  const resendFetcher = useFetcher()
  const isRevoking = revokeFetcher.state !== "idle"
  const isResending = resendFetcher.state !== "idle"

  return (
    <tr>
      <td>{invite.email}</td>
      <td>{JSON.parse(invite.groupNames).join(", ")}</td>
      <td><StepBadges invite={invite} /></td>
      <td>{invite.invitedBy}</td>
      <td>{new Date(invite.expiresAt + "Z").toLocaleDateString()}</td>
      <td>
        <div className={styles.actionBtns}>
          <resendFetcher.Form method="post">
            <input type="hidden" name="intent" value="resend" />
            <input type="hidden" name="inviteId" value={invite.id} />
            <button type="submit" className={styles.btnGhost} disabled={isResending || isRevoking}>
              {isResending ? "Resending..." : "Resend"}
            </button>
          </resendFetcher.Form>
          <revokeFetcher.Form method="post">
            <input type="hidden" name="intent" value="revoke" />
            <input type="hidden" name="inviteId" value={invite.id} />
            <button type="submit" className={`${styles.btnGhost} ${styles.btnGhostDanger}`} disabled={isRevoking || isResending}>
              {isRevoking ? "Revoking..." : "Revoke"}
            </button>
          </revokeFetcher.Form>
        </div>
      </td>
    </tr>
  )
}

function FailedInviteRow({ invite }: { invite: Invite }) {
  const retryFetcher = useFetcher()
  const revokeFetcher = useFetcher()
  const isRetrying = retryFetcher.state !== "idle"
  const isRevoking = revokeFetcher.state !== "idle"

  return (
    <tr>
      <td>{invite.email}</td>
      <td className={styles.errorText}>{invite.lastError ?? "Unknown error"}</td>
      <td>{invite.failedAt ? new Date(invite.failedAt + "Z").toLocaleString() : "—"}</td>
      <td>
        <div className={styles.actionBtns}>
          <retryFetcher.Form method="post">
            <input type="hidden" name="intent" value="retry" />
            <input type="hidden" name="inviteId" value={invite.id} />
            <button type="submit" className={styles.btnGhost} disabled={isRetrying || isRevoking}>
              {isRetrying ? "Retrying..." : "Retry"}
            </button>
          </retryFetcher.Form>
          <revokeFetcher.Form method="post">
            <input type="hidden" name="intent" value="revoke" />
            <input type="hidden" name="inviteId" value={invite.id} />
            <button type="submit" className={`${styles.btnGhost} ${styles.btnGhostDanger}`} disabled={isRevoking || isRetrying}>
              {isRevoking ? "Revoking..." : "Revoke"}
            </button>
          </revokeFetcher.Form>
        </div>
      </td>
    </tr>
  )
}
