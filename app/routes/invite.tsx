import { useState, useEffect } from "react"
import { useNavigation } from "react-router"
import type { Route } from "./+types/invite"
import { runEffect } from "~/lib/runtime.server"
import { InviteRepo } from "~/lib/services/InviteRepo.server"
import { VaultPki } from "~/lib/services/VaultPki.server"
import { acceptInvite } from "~/lib/workflows/invite.server"
import { hashToken } from "~/lib/crypto.server"
import { Effect } from "effect"

export function meta() {
  return [{ title: "Join Daddyshome" }]
}

export async function loader({ params }: Route.LoaderArgs) {
  const token = params.token
  if (!token) {
    return { valid: false, error: "Missing invite token" }
  }

  try {
    const tokenHash = hashToken(token)

    const invite = await runEffect(
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        return yield* repo.findByTokenHash(tokenHash)
      }),
    )

    if (!invite) {
      return { valid: false, error: "Invalid invite link" }
    }

    if (invite.usedAt) {
      return { valid: false, error: "This invite has already been used" }
    }

    if (new Date(invite.expiresAt + "Z") < new Date()) {
      return { valid: false, error: "This invite has expired" }
    }

    if (invite.attempts >= 5) {
      return {
        valid: false,
        error: "Too many attempts. Please contact an administrator.",
      }
    }

    // One-time P12 password reveal
    let p12Password: string | null = null
    const stepState = JSON.parse(invite.stepState || "{}")

    if (!stepState.passwordRevealed) {
      p12Password = await runEffect(
        Effect.gen(function* () {
          const vault = yield* VaultPki
          const password = yield* vault.consumeP12Password(invite.id)

          if (password) {
            const repo = yield* InviteRepo
            yield* repo.updateStepState(invite.id, {
              passwordRevealed: true,
            })
          }

          return password
        }),
      )
    }

    return {
      valid: true,
      email: invite.email,
      groupNames: JSON.parse(invite.groupNames) as string[],
      p12Password,
    }
  } catch {
    return { valid: false, error: "Something went wrong" }
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const token = params.token
  if (!token) {
    return { error: "Missing invite token" }
  }

  // CSRF: verify origin
  const origin = request.headers.get("Origin")
  if (origin && !origin.endsWith("daddyshome.fr")) {
    return { error: "Invalid request origin" }
  }

  const formData = await request.formData()
  const username = (formData.get("username") as string)?.trim()
  const password = formData.get("password") as string
  const confirmPassword = formData.get("confirmPassword") as string

  // Validate
  if (!username || !/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
    return {
      error:
        "Username must be 3-32 characters (letters, numbers, hyphens, underscores)",
    }
  }
  if (!password || password.length < 12) {
    return { error: "Password must be at least 12 characters" }
  }
  if (password !== confirmPassword) {
    return { error: "Passwords do not match" }
  }

  // Rate limit: increment attempt counter
  const tokenHash = hashToken(token)
  await runEffect(
    Effect.gen(function* () {
      const repo = yield* InviteRepo
      yield* repo.incrementAttempt(tokenHash)
    }),
  ).catch(() => {})

  try {
    await runEffect(acceptInvite(token, { username, password }))
    return { success: true, redirectUrl: "https://home.daddyshome.fr/welcome" }
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to create account"
    return { error: message }
  }
}

export default function InvitePage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  if (!loaderData.valid) {
    return (
      <main className="invite-page">
        <div className="invite-card">
          <div className="error-icon">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              width="48"
              height="48"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <h1>Unable to Join</h1>
          <p className="error-message">{"error" in loaderData ? loaderData.error : "Invalid invite"}</p>
        </div>
        <style>{pageStyles}</style>
      </main>
    )
  }

  // Redirect on success
  if (actionData && "success" in actionData && actionData.success) {
    return (
      <main className="invite-page">
        <div className="invite-card">
          <div className="success-icon">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              width="48"
              height="48"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="16 10 11 15 8 12" />
            </svg>
          </div>
          <h1>Account Created!</h1>
          <p>Redirecting you to sign in...</p>
          <a href={actionData.redirectUrl} className="btn btn-primary">
            Continue to Sign In
          </a>
        </div>
        <RedirectScript url={actionData.redirectUrl} />
        <style>{pageStyles}</style>
      </main>
    )
  }

  return (
    <main className="invite-page">
      <div className="invite-card">
        <h1>Join Daddyshome</h1>
        <p className="subtitle">
          You've been invited as <strong>{loaderData.email}</strong>
        </p>

        {loaderData.groupNames && loaderData.groupNames.length > 0 && (
          <p className="groups-info">
            Groups: {loaderData.groupNames.join(", ")}
          </p>
        )}

        {/* P12 Password Section */}
        {loaderData.p12Password && <PasswordReveal password={loaderData.p12Password} />}

        {/* Cert Check */}
        <CertCheck />

        {/* Error */}
        {actionData && "error" in actionData && (
          <div className="alert alert-error">{actionData.error}</div>
        )}

        {/* Account Creation Form */}
        <AccountForm />
      </div>
      <style>{pageStyles}</style>
    </main>
  )
}

function PasswordReveal({ password }: { password: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <div className="password-section">
      <h2>Certificate Password</h2>
      <p className="warning-text">
        Save this password — you'll need it to install the certificate from your
        email. It won't be shown again.
      </p>
      <div className="password-display">
        <code>{password}</code>
        <button
          type="button"
          className="btn btn-small"
          onClick={() => {
            navigator.clipboard.writeText(password)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          }}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    </div>
  )
}

function CertCheck() {
  const [status, setStatus] = useState<
    "checking" | "installed" | "not-installed"
  >("checking")

  useEffect(() => {
    fetch("https://home.daddyshome.fr/health", { mode: "cors" })
      .then((r) => {
        if (r.ok) setStatus("installed")
        else setStatus("not-installed")
      })
      .catch(() => setStatus("not-installed"))
  }, [])

  return (
    <div className="cert-check">
      {status === "checking" && (
        <p className="cert-status checking">Checking certificate...</p>
      )}
      {status === "installed" && (
        <p className="cert-status success">Certificate detected</p>
      )}
      {status === "not-installed" && (
        <div className="cert-warning">
          <p>
            It looks like your certificate isn't installed yet. Install the .p12
            file from your email, then refresh this page.
          </p>
        </div>
      )}
    </div>
  )
}

function AccountForm() {
  const navigation = useNavigation()
  const isSubmitting = navigation.state === "submitting"

  return (
    <form method="post" className="account-form">
      <h2>Create Your Account</h2>

      <div className="form-group">
        <label htmlFor="username">Username</label>
        <input
          id="username"
          name="username"
          type="text"
          required
          pattern="^[a-zA-Z0-9_-]{3,32}$"
          placeholder="Choose a username"
          className="input"
          autoComplete="username"
        />
        <span className="hint">3-32 characters: letters, numbers, hyphens, underscores</span>
      </div>

      <div className="form-group">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={12}
          placeholder="Choose a strong password"
          className="input"
          autoComplete="new-password"
        />
        <span className="hint">At least 12 characters</span>
      </div>

      <div className="form-group">
        <label htmlFor="confirmPassword">Confirm Password</label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
          minLength={12}
          placeholder="Confirm your password"
          className="input"
          autoComplete="new-password"
        />
      </div>

      <button type="submit" className="btn btn-primary btn-full" disabled={isSubmitting}>
        {isSubmitting ? "Creating Account..." : "Create Account"}
      </button>
    </form>
  )
}

function RedirectScript({ url }: { url: string }) {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `setTimeout(function(){window.location.href="${url}"},2000)`,
      }}
    />
  )
}

const pageStyles = `
  .invite-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 2rem; }
  .invite-card { background: var(--color-bg-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 2.5rem; max-width: 480px; width: 100%; }
  .invite-card h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem; }
  .invite-card h2 { font-size: 1.1rem; font-weight: 600; margin-bottom: 0.75rem; }
  .subtitle { color: var(--color-text-muted); margin-bottom: 0.5rem; }
  .groups-info { color: var(--color-text-muted); font-size: 0.875rem; margin-bottom: 1.5rem; }
  .error-icon { color: #ef4444; margin-bottom: 1rem; }
  .success-icon { color: #22c55e; margin-bottom: 1rem; }
  .error-message { color: var(--color-text-muted); }
  .password-section { background: rgba(59,130,246,0.08); border: 1px solid rgba(59,130,246,0.2); border-radius: var(--radius-sm); padding: 1rem; margin-bottom: 1.5rem; }
  .warning-text { color: #fbbf24; font-size: 0.8rem; margin-bottom: 0.75rem; }
  .password-display { display: flex; align-items: center; gap: 0.75rem; }
  .password-display code { flex: 1; background: var(--color-bg); padding: 0.5rem 0.75rem; border-radius: var(--radius-sm); font-size: 0.8rem; word-break: break-all; color: #e5e5e5; }
  .btn-small { padding: 0.375rem 0.75rem; font-size: 0.75rem; background: var(--color-border); color: var(--color-text); border: none; border-radius: var(--radius-sm); cursor: pointer; }
  .cert-check { margin-bottom: 1.5rem; }
  .cert-status { font-size: 0.875rem; padding: 0.5rem 0; }
  .cert-status.checking { color: var(--color-text-muted); }
  .cert-status.success { color: #22c55e; }
  .cert-warning { background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.2); border-radius: var(--radius-sm); padding: 0.75rem 1rem; }
  .cert-warning p { color: #fbbf24; font-size: 0.8rem; margin: 0; }
  .account-form { margin-top: 1.5rem; }
  .form-group { margin-bottom: 1rem; }
  .form-group label { display: block; font-size: 0.875rem; color: var(--color-text-muted); margin-bottom: 0.375rem; }
  .input { width: 100%; padding: 0.5rem 0.75rem; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-sm); color: var(--color-text); font-size: 0.875rem; box-sizing: border-box; }
  .input:focus { outline: none; border-color: var(--color-accent); }
  .hint { font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.25rem; display: block; }
  .btn { padding: 0.5rem 1.25rem; border-radius: var(--radius-sm); font-size: 0.875rem; font-weight: 500; cursor: pointer; border: none; transition: background-color var(--transition); }
  .btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .btn-primary { background: var(--color-accent); color: #fff; }
  .btn-primary:hover:not(:disabled) { background: var(--color-accent-hover); }
  .btn-full { width: 100%; margin-top: 0.5rem; }
  .alert { padding: 0.75rem 1rem; border-radius: var(--radius-sm); font-size: 0.875rem; margin-bottom: 1rem; }
  .alert-error { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #fca5a5; }
`
