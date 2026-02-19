import { useState, useEffect, useRef } from "react"
import { useFetcher, useRevalidator } from "react-router"
import type { Route } from "./+types/admin.users"
import { runEffect } from "~/lib/runtime.server"
import { LldapClient } from "~/lib/services/LldapClient.server"
import { InviteRepo, type Invite, type Revocation } from "~/lib/services/InviteRepo.server"
import { queueInvite, revokeInvite, revokeUser, resendCert } from "~/lib/workflows/invite.server"
import { Effect } from "effect"
import styles from "./admin.users.module.css"

const SYSTEM_USERS = ["admin", "gitea-service"]

export async function loader() {
  const [users, groups, pendingInvites, failedInvites, revocations, revokingInvites] = await Promise.all([
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
    runEffect(
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        return yield* repo.findRevocations()
      }),
    ),
    runEffect(
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        return yield* repo.findAwaitingRevertMerge()
      }),
    ),
  ])

  return { users, groups, pendingInvites, failedInvites, revocations, revokingInvites }
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
      return { success: true, message: `Revocation cleared for ${revocation.email}. You can now re-invite them.`, reinviteEmail: revocation.email }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to clear revocation"
      return { error: message }
    }
  }

  // Default: send new invite
  const email = formData.get("email") as string
  const selectedGroups = formData.getAll("groups") as string[]
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
  if (invite.usedBy === "__revoking__") return <span className={`${styles.badge} ${styles.badgeProgress}`}>Revoking (PR #{invite.revertPrNumber})...</span>
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
  const { users, groups, pendingInvites, failedInvites, revocations, revokingInvites } = loaderData
  const fetcher = useFetcher<typeof action>()
  const formRef = useRef<HTMLFormElement>(null)
  const isSubmitting = fetcher.state !== "idle"
  const revalidator = useRevalidator()

  useEffect(() => {
    if (fetcher.data && "success" in fetcher.data && fetcher.data.success) {
      formRef.current?.reset()
    }
  }, [fetcher.data])

  // Auto-refresh while invites are still processing or revoking
  useEffect(() => {
    const hasIncomplete = pendingInvites.some((inv) => !inv.emailSent || (inv.emailSent && !inv.certVerified))
    if (!hasIncomplete && revokingInvites.length === 0) return

    const interval = setInterval(() => {
      if (revalidator.state === "idle") {
        revalidator.revalidate()
      }
    }, 5000)

    return () => clearInterval(interval)
  }, [pendingInvites, revokingInvites, revalidator])

  const actionData = fetcher.data
  const hasWarning = actionData && "warning" in actionData

  return (
    <>
      {/* Invite Form */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Send Invite</h2>

        {actionData && "error" in actionData && (
          <div className={`${styles.alert} ${styles.alertError}`}>{actionData.error}</div>
        )}
        {actionData && "success" in actionData && actionData.success && (
          <div className={`${styles.alert} ${styles.alertSuccess}`}>{actionData.message}</div>
        )}
        {hasWarning && (
          <div className={`${styles.alert} ${styles.alertWarning}`}>
            <p>{actionData.warning}</p>
            <fetcher.Form method="post" style={{ marginTop: "0.5rem" }}>
              <input type="hidden" name="email" value={actionData.email} />
              <input type="hidden" name="confirmed" value="true" />
              <input type="hidden" name="revocationId" value={actionData.revocationId} />
              {(actionData.groups as string[]).map((g) => (
                <input key={g} type="hidden" name="groups" value={g} />
              ))}
              <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>
                Proceed anyway
              </button>
            </fetcher.Form>
          </div>
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

      {/* Active Invites */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Active Invites ({pendingInvites.length + revokingInvites.length})</h2>
        {pendingInvites.length === 0 && revokingInvites.length === 0 ? (
          <p className={styles.emptyState}>No active invites</p>
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
                {revokingInvites.map((inv) => (
                  <tr key={inv.id}>
                    <td>{inv.email}</td>
                    <td>{JSON.parse(inv.groupNames).join(", ")}</td>
                    <td><StepBadges invite={inv} /></td>
                    <td>{inv.invitedBy}</td>
                    <td>{new Date(inv.expiresAt + "Z").toLocaleDateString()}</td>
                    <td />
                  </tr>
                ))}
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
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <UserRow key={u.id} user={u} isSystem={SYSTEM_USERS.includes(u.id)} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Revoked Users */}
      {revocations.length > 0 && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Revoked Users ({revocations.length})</h2>
          <div className={styles.tableContainer}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Username</th>
                  <th>Reason</th>
                  <th>Revoked</th>
                  <th>By</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {revocations.map((r) => (
                  <RevokedUserRow key={r.id} revocation={r} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
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
      <td>{invite.failedAt ? new Date(invite.failedAt + "Z").toLocaleString() : "\u2014"}</td>
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

function UserRow({ user, isSystem }: { user: { id: string; displayName: string; email: string; creationDate: string }; isSystem: boolean }) {
  const [showRevoke, setShowRevoke] = useState(false)
  const certFetcher = useFetcher()
  const revokeFetcher = useFetcher()
  const isSendingCert = certFetcher.state !== "idle"
  const isRevoking = revokeFetcher.state !== "idle"

  useEffect(() => {
    if (revokeFetcher.data && "success" in revokeFetcher.data) {
      setShowRevoke(false)
    }
  }, [revokeFetcher.data])

  return (
    <>
      <tr>
        <td>{user.id}</td>
        <td>{user.displayName}</td>
        <td>{user.email}</td>
        <td>{new Date(user.creationDate).toLocaleDateString()}</td>
        <td>
          {!isSystem && (
            <div className={styles.actionBtns}>
              <certFetcher.Form method="post">
                <input type="hidden" name="intent" value="resendCert" />
                <input type="hidden" name="username" value={user.id} />
                <input type="hidden" name="email" value={user.email} />
                <button type="submit" className={styles.btnGhost} disabled={isSendingCert || isRevoking}>
                  {isSendingCert ? "Sending..." : "Send Cert"}
                </button>
              </certFetcher.Form>
              <button
                type="button"
                className={`${styles.btnGhost} ${styles.btnGhostDanger}`}
                disabled={isRevoking}
                onClick={() => setShowRevoke(!showRevoke)}
              >
                Revoke
              </button>
            </div>
          )}
        </td>
      </tr>
      {showRevoke && (
        <tr>
          <td colSpan={5}>
            <revokeFetcher.Form method="post" className={styles.inlineRevokeForm}>
              <input type="hidden" name="intent" value="revokeUser" />
              <input type="hidden" name="username" value={user.id} />
              <input type="hidden" name="email" value={user.email} />
              <input
                name="reason"
                type="text"
                placeholder="Reason (optional)"
                className={styles.input}
                style={{ flex: 1 }}
              />
              <button type="submit" className={`${styles.btn} ${styles.btnDanger}`} disabled={isRevoking}>
                {isRevoking ? "Revoking..." : "Confirm Revoke"}
              </button>
              <button type="button" className={styles.btnGhost} onClick={() => setShowRevoke(false)}>
                Cancel
              </button>
            </revokeFetcher.Form>
          </td>
        </tr>
      )}
    </>
  )
}

function RevokedUserRow({ revocation }: { revocation: Revocation }) {
  const fetcher = useFetcher()
  const isSubmitting = fetcher.state !== "idle"

  return (
    <tr>
      <td>{revocation.email}</td>
      <td>{revocation.username}</td>
      <td>{revocation.reason ?? "\u2014"}</td>
      <td>{new Date(revocation.revokedAt + "Z").toLocaleDateString()}</td>
      <td>{revocation.revokedBy}</td>
      <td>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="reinviteRevoked" />
          <input type="hidden" name="revocationId" value={revocation.id} />
          <button type="submit" className={styles.btnGhost} disabled={isSubmitting}>
            {isSubmitting ? "Processing..." : "Re-invite"}
          </button>
        </fetcher.Form>
      </td>
    </tr>
  )
}
