import { Suspense, use, useState, useEffect, useRef } from "react"
import { redirect, useNavigation } from "react-router"
import type { Route } from "./+types/invite"
import { runEffect } from "~/lib/runtime.server"
import { InviteRepo } from "~/lib/services/InviteRepo.server"
import { VaultPki } from "~/lib/services/VaultPki.server"
import { acceptInvite } from "~/lib/workflows/invite.server"
import { hashToken } from "~/lib/crypto.server"
import { Effect } from "effect"
import styles from "./invite.module.css"

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
    return redirect("https://home.daddyshome.fr/welcome")
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to create account"
    return { error: message }
  }
}

function checkCert(): Promise<boolean> {
  return fetch("https://home.daddyshome.fr/health", { mode: "cors" })
    .then((r) => r.ok)
    .catch(() => false)
}

export default function InvitePage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const [certPromise] = useState(() => checkCert())

  if (!loaderData.valid) {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <div className={styles.errorIcon}>
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
          <p className={styles.errorMessage}>{"error" in loaderData ? loaderData.error : "Invalid invite"}</p>
        </div>
      </main>
    )
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1>Join Daddyshome</h1>
        <p className={styles.subtitle}>
          You've been invited as <strong>{loaderData.email}</strong>
        </p>

        {loaderData.groupNames && loaderData.groupNames.length > 0 && (
          <p className={styles.groupsInfo}>
            Groups: {loaderData.groupNames.join(", ")}
          </p>
        )}

        {/* P12 Password Section */}
        {loaderData.p12Password && <PasswordReveal password={loaderData.p12Password} />}

        {/* Cert Check */}
        <Suspense fallback={<CertCheckLoading />}>
          <CertCheckResult certPromise={certPromise} />
        </Suspense>

        {/* Error */}
        {actionData && "error" in actionData && (
          <div className={`${styles.alert} ${styles.alertError}`}>{actionData.error}</div>
        )}

        {/* Account Creation Form */}
        <AccountForm />
      </div>
    </main>
  )
}

function PasswordReveal({ password }: { password: string }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return (
    <div className={styles.passwordSection}>
      <h2>Certificate Password</h2>
      <p className={styles.warningText}>
        Save this password — you'll need it to install the certificate from your
        email. It won't be shown again.
      </p>
      <div className={styles.passwordDisplay}>
        <code>{password}</code>
        <button
          type="button"
          className={styles.btnSmall}
          onClick={() => {
            navigator.clipboard.writeText(password)
            setCopied(true)
            if (timerRef.current) clearTimeout(timerRef.current)
            timerRef.current = setTimeout(() => setCopied(false), 2000)
          }}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    </div>
  )
}

function CertCheckLoading() {
  return (
    <div className={styles.certCheck}>
      <p className={`${styles.certStatus} ${styles.certStatusChecking}`}>Checking certificate...</p>
    </div>
  )
}

function CertCheckResult({ certPromise }: { certPromise: Promise<boolean> }) {
  const installed = use(certPromise)

  return (
    <div className={styles.certCheck}>
      {installed ? (
        <p className={`${styles.certStatus} ${styles.certStatusSuccess}`}>Certificate detected</p>
      ) : (
        <div className={styles.certWarning}>
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
    <form method="post" className={styles.accountForm}>
      <h2>Create Your Account</h2>

      <div className={styles.formGroup}>
        <label htmlFor="username">Username</label>
        <input
          id="username"
          name="username"
          type="text"
          required
          pattern="^[a-zA-Z0-9_-]{3,32}$"
          placeholder="Choose a username"
          className={styles.input}
          autoComplete="username"
        />
        <span className={styles.hint}>3-32 characters: letters, numbers, hyphens, underscores</span>
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={12}
          placeholder="Choose a strong password"
          className={styles.input}
          autoComplete="new-password"
        />
        <span className={styles.hint}>At least 12 characters</span>
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="confirmPassword">Confirm Password</label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
          minLength={12}
          placeholder="Confirm your password"
          className={styles.input}
          autoComplete="new-password"
        />
      </div>

      <button type="submit" className={`${styles.btn} ${styles.btnPrimary} ${styles.btnFull}`} disabled={isSubmitting}>
        {isSubmitting ? "Creating Account..." : "Create Account"}
      </button>
    </form>
  )
}
