import { useEffect, useRef } from "react"
import { useFetcher, useRevalidator } from "react-router"
import type { Route } from "./+types/users"
import { parseAuthHeaders } from "~/lib/auth.server"
import { runEffect } from "~/lib/runtime.server"
import { LldapClient } from "~/lib/services/LldapClient.server"
import { InviteRepo, type Invite } from "~/lib/services/InviteRepo.server"
import { queueInvite } from "~/lib/workflows/invite.server"
import { Effect } from "effect"

export function meta() {
  return [{ title: "Users - Duro" }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = parseAuthHeaders(request)
  if (!auth.groups.includes("lldap_admin")) {
    throw new Response("Forbidden", { status: 403 })
  }

  const [users, groups, pendingInvites] = await Promise.all([
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
  ])

  return { user: auth.user, users, groups, pendingInvites }
}

export async function action({ request }: Route.ActionArgs) {
  const auth = parseAuthHeaders(request)
  if (!auth.groups.includes("lldap_admin")) {
    throw new Response("Forbidden", { status: 403 })
  }

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

  if (intent === "resend") {
    const inviteId = formData.get("inviteId") as string
    if (!inviteId) return { error: "Missing invite ID" }
    try {
      // Revoke old invite, then queue a new one with same email/groups
      const invite = await runEffect(
        Effect.gen(function* () {
          const repo = yield* InviteRepo
          const inv = yield* repo.findById(inviteId)
          if (!inv) return null
          yield* repo.revoke(inviteId)
          return inv
        }),
      )
      if (!invite) return { error: "Invite not found" }

      const result = await runEffect(
        queueInvite({
          email: invite.email,
          groups: JSON.parse(invite.groups) as number[],
          groupNames: JSON.parse(invite.groupNames) as string[],
          invitedBy: auth.user ?? "admin",
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
        invitedBy: auth.user ?? "admin",
      }),
    )
    return result
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to send invite"
    return { error: message }
  }
}

function parseStepState(invite: Invite): {
  certIssued: boolean
  prCreated: boolean
  emailSent: boolean
} {
  try {
    const state = JSON.parse(invite.stepState || "{}")
    return {
      certIssued: !!state.certIssued,
      prCreated: !!state.prCreated,
      emailSent: !!state.emailSent,
    }
  } catch {
    return { certIssued: false, prCreated: false, emailSent: false }
  }
}

function isFullyProcessed(invite: Invite): boolean {
  const state = parseStepState(invite)
  return state.certIssued && state.emailSent
}

function StepBadges({ invite }: { invite: Invite }) {
  const state = parseStepState(invite)
  const anyStarted = state.certIssued || state.prCreated || state.emailSent
  const allDone = state.certIssued && state.emailSent

  if (allDone) {
    return <span className="badge badge-success">Sent</span>
  }
  if (!anyStarted) {
    return <span className="badge badge-pending">Queued</span>
  }
  return (
    <span className="badge-group">
      {state.certIssued && <span className="badge badge-done">Cert</span>}
      {state.prCreated && <span className="badge badge-done">PR</span>}
      {state.emailSent && <span className="badge badge-done">Email</span>}
      <span className="badge badge-progress">Processing...</span>
    </span>
  )
}

export default function UsersPage({ loaderData }: Route.ComponentProps) {
  const { user, users, groups, pendingInvites } = loaderData
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
    const hasIncomplete = pendingInvites.some((inv) => !isFullyProcessed(inv))
    if (!hasIncomplete) return

    const interval = setInterval(() => {
      if (revalidator.state === "idle") {
        revalidator.revalidate()
      }
    }, 5000)

    return () => clearInterval(interval)
  }, [pendingInvites, revalidator])

  return (
    <main className="page">
      <header className="header">
        <div>
          <h1 className="title">User Management</h1>
          <a href="/" className="back-link">
            Back to Dashboard
          </a>
        </div>
        <span className="user-label">{user}</span>
      </header>

      {/* Invite Form */}
      <section className="card">
        <h2 className="card-title">Send Invite</h2>

        {fetcher.data && "error" in fetcher.data && (
          <div className="alert alert-error">{fetcher.data.error}</div>
        )}
        {fetcher.data && "success" in fetcher.data && fetcher.data.success && (
          <div className="alert alert-success">{fetcher.data.message}</div>
        )}

        <fetcher.Form method="post" ref={formRef}>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              required
              placeholder="user@example.com"
              className="input"
            />
          </div>

          <div className="form-group">
            <label>Groups</label>
            <div className="checkbox-grid">
              {groups.map((g) => (
                <label key={g.id} className="checkbox-label">
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

          <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
            {isSubmitting ? "Sending..." : "Send Invite"}
          </button>
        </fetcher.Form>
      </section>

      {/* Pending Invites */}
      <section className="card">
        <h2 className="card-title">Pending Invites ({pendingInvites.length})</h2>
        {pendingInvites.length === 0 ? (
          <p className="empty-state">No pending invites</p>
        ) : (
          <div className="table-container">
            <table className="table">
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
      <section className="card">
        <h2 className="card-title">Users ({users.length})</h2>
        <div className="table-container">
          <table className="table">
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

      <style>{`
        .page { max-width: 960px; margin: 0 auto; padding: 2rem 1.5rem; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 2rem; }
        .title { font-size: 1.75rem; font-weight: 700; margin-bottom: 0.25rem; }
        .back-link { font-size: 0.8rem; color: var(--color-text-muted); }
        .back-link:hover { color: var(--color-accent); }
        .user-label { font-size: 0.875rem; color: var(--color-text-muted); }
        .card { background: var(--color-bg-card); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 1.5rem; margin-bottom: 1.5rem; }
        .card-title { font-size: 1.1rem; font-weight: 600; margin-bottom: 1rem; }
        .form-group { margin-bottom: 1rem; }
        .form-group label { display: block; font-size: 0.875rem; color: var(--color-text-muted); margin-bottom: 0.375rem; }
        .input { width: 100%; padding: 0.5rem 0.75rem; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-sm); color: var(--color-text); font-size: 0.875rem; }
        .input:focus { outline: none; border-color: var(--color-accent); }
        .checkbox-grid { display: flex; flex-wrap: wrap; gap: 0.75rem; }
        .checkbox-label { display: flex; align-items: center; gap: 0.375rem; font-size: 0.875rem; cursor: pointer; }
        .btn { padding: 0.5rem 1.25rem; border-radius: var(--radius-sm); font-size: 0.875rem; font-weight: 500; cursor: pointer; border: none; transition: background-color var(--transition); }
        .btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .btn-primary { background: var(--color-accent); color: #fff; }
        .btn-primary:hover:not(:disabled) { background: var(--color-accent-hover); }
        .alert { padding: 0.75rem 1rem; border-radius: var(--radius-sm); font-size: 0.875rem; margin-bottom: 1rem; }
        .alert-error { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #fca5a5; }
        .alert-success { background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.3); color: #86efac; }
        .table-container { overflow-x: auto; }
        .table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
        .table th { text-align: left; padding: 0.5rem 0.75rem; color: var(--color-text-muted); font-weight: 500; border-bottom: 1px solid var(--color-border); }
        .table td { padding: 0.5rem 0.75rem; border-bottom: 1px solid rgba(51,51,51,0.5); }
        .empty-state { color: var(--color-text-muted); font-size: 0.875rem; }
        .action-btns { display: flex; gap: 0.5rem; }
        .btn-ghost { padding: 0.25rem 0.625rem; font-size: 0.75rem; background: transparent; color: var(--color-text-muted); border: 1px solid var(--color-border); border-radius: var(--radius-sm); cursor: pointer; transition: all 150ms; }
        .btn-ghost:hover:not(:disabled) { color: var(--color-text); border-color: var(--color-text-muted); }
        .btn-ghost.danger:hover:not(:disabled) { color: #fca5a5; border-color: rgba(239,68,68,0.4); }
        .badge { display: inline-block; padding: 0.125rem 0.5rem; border-radius: 9999px; font-size: 0.7rem; font-weight: 500; }
        .badge-success { background: rgba(34,197,94,0.15); color: #86efac; }
        .badge-pending { background: rgba(234,179,8,0.15); color: #fde047; }
        .badge-done { background: rgba(34,197,94,0.15); color: #86efac; }
        .badge-progress { background: rgba(59,130,246,0.15); color: #93c5fd; }
        .badge-group { display: inline-flex; gap: 0.25rem; align-items: center; }
      `}</style>
    </main>
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
        <div className="action-btns">
          <resendFetcher.Form method="post">
            <input type="hidden" name="intent" value="resend" />
            <input type="hidden" name="inviteId" value={invite.id} />
            <button type="submit" className="btn-ghost" disabled={isResending || isRevoking}>
              {isResending ? "Resending..." : "Resend"}
            </button>
          </resendFetcher.Form>
          <revokeFetcher.Form method="post">
            <input type="hidden" name="intent" value="revoke" />
            <input type="hidden" name="inviteId" value={invite.id} />
            <button type="submit" className="btn-ghost danger" disabled={isRevoking || isResending}>
              {isRevoking ? "Revoking..." : "Revoke"}
            </button>
          </revokeFetcher.Form>
        </div>
      </td>
    </tr>
  )
}
