import { Suspense, use, useState, useEffect, useRef } from "react"
import { redirect, useNavigation } from "react-router"
import type { Route } from "./+types/invite"
import { runEffect } from "~/lib/runtime.server"
import { InviteRepo } from "~/lib/services/InviteRepo.server"
import { VaultPki } from "~/lib/services/VaultPki.server"
import { acceptInvite } from "~/lib/workflows/invite.server"
import { hashToken } from "~/lib/crypto.server"
import { Effect } from "effect"
import { Button } from "@base-ui/react/button"
import { Field } from "@base-ui/react/field"
import { Input } from "@base-ui/react/input"
import { ScratchCard } from "~/components/ScratchCard/ScratchCard"
import shared from "./shared.module.css"
import styles from "./invite.module.css"

export function meta() {
  return [{ title: "Join Daddyshome" }]
}

export async function loader({ params }: Route.LoaderArgs) {
  const token = params.token
  if (!token) {
    return { valid: false as const, error: "Missing invite token" }
  }

  try {
    const tokenHash = hashToken(token)

    return await runEffect(
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const vault = yield* VaultPki

        const invite = yield* repo.findByTokenHash(tokenHash)
        if (!invite) {
          return { valid: false as const, error: "Invalid invite link" }
        }

        if (invite.usedAt) {
          return { valid: false as const, error: "already_used" }
        }

        if (new Date(invite.expiresAt) < new Date()) {
          return { valid: false as const, error: "expired" }
        }

        if (invite.attempts >= 5) {
          return { valid: false as const, error: "Too many attempts. Please contact an administrator." }
        }

        // Check if P12 password is still available (read-only — don't consume yet)
        const pw = yield* vault.getP12Password(invite.id)
        const passwordAvailable = pw !== null

        return {
          valid: true as const,
          email: invite.email,
          groupNames: JSON.parse(invite.groupNames) as string[],
          passwordAvailable,
        }
      }),
    )
  } catch {
    return { valid: false as const, error: "Something went wrong" }
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
  const intent = formData.get("intent") as string | null

  // Handle scratch-to-reveal: consume password from Vault
  if (intent === "reveal") {
    try {
      const tokenHash = hashToken(token)
      const result = await runEffect(
        Effect.gen(function* () {
          const repo = yield* InviteRepo
          const invite = yield* repo.findByTokenHash(tokenHash)
          if (!invite) return { password: null }

          const vault = yield* VaultPki
          const password = yield* vault.consumeP12Password(invite.id)
          return { password }
        }),
      )
      return result
    } catch {
      return { password: null }
    }
  }

  // Handle account creation
  const username = (formData.get("username") as string)?.trim()
  const password = formData.get("password") as string
  const confirmPassword = formData.get("confirmPassword") as string

  // Validate
  if (!username || !/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
    return {
      error: "Username must be 3-32 characters (letters, numbers, hyphens, underscores)",
    }
  }
  if (!password || password.length < 12) {
    return { error: "Password must be at least 12 characters" }
  }
  if (password !== confirmPassword) {
    return { error: "Passwords do not match" }
  }

  try {
    const tokenHash = hashToken(token)
    await runEffect(
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        // Rate limit: increment attempt counter (best-effort)
        yield* repo.incrementAttempt(tokenHash).pipe(Effect.ignore)
        yield* acceptInvite(token, { username, password })
      }),
    )
    return redirect("https://home.daddyshome.fr/welcome")
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to create account"
    return { error: message }
  }
}

function checkCert(): Promise<boolean> {
  return fetch("https://home.daddyshome.fr/health", { mode: "cors" })
    .then((r) => r.ok)
    .catch(() => false)
}

export default function InvitePage({ loaderData, actionData }: Route.ComponentProps) {
  const [certPromise] = useState(() => checkCert())

  if (!loaderData.valid) {
    const { error } = loaderData

    if (error === "expired") {
      return (
        <main className={shared.page}>
          <div className={shared.card}>
            <div className={shared.errorIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="48" height="48">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <h1>Invite Expired</h1>
            <p className={styles.errorMessage}>
              This invite has expired. Use the link in your invitation email to request a new one.
            </p>
          </div>
        </main>
      )
    }

    if (error === "already_used") {
      return (
        <main className={shared.page}>
          <div className={shared.card}>
            <div className={shared.errorIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="48" height="48">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <h1>Already Joined</h1>
            <p className={styles.errorMessage}>
              This invite has already been used. If you need help, contact the person who invited you.
            </p>
          </div>
        </main>
      )
    }

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
          <h1>Unable to Join</h1>
          <p className={styles.errorMessage}>{error}</p>
        </div>
      </main>
    )
  }

  return (
    <main className={shared.page}>
      <div className={shared.card}>
        <h1>Join Daddyshome</h1>
        <p className={styles.subtitle}>
          You've been invited as <strong>{loaderData.email}</strong>
        </p>

        {loaderData.groupNames && loaderData.groupNames.length > 0 && (
          <p className={styles.groupsInfo}>Groups: {loaderData.groupNames.join(", ")}</p>
        )}

        {/* P12 Password Section */}
        <PasswordReveal passwordAvailable={loaderData.passwordAvailable} />

        {/* Cert Check */}
        <Suspense fallback={<CertCheckLoading />}>
          <CertCheckResult certPromise={certPromise} />
        </Suspense>

        {/* Error */}
        {actionData && "error" in actionData && <div className={shared.alertError}>{actionData.error}</div>}

        {/* Account Creation Form */}
        <AccountForm />
      </div>
    </main>
  )
}

function PasswordReveal({ passwordAvailable }: { passwordAvailable: boolean }) {
  const [password, setPassword] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const handleReveal = async () => {
    const res = await fetch("", {
      method: "POST",
      body: new URLSearchParams({ intent: "reveal" }),
    })
    const result = await res.json()
    if (result.password) {
      setPassword(result.password)
      setRevealed(true)
    }
  }

  if (!passwordAvailable) {
    return (
      <div className={styles.passwordSection}>
        <h2>Certificate Password</h2>
        <p className={styles.infoText}>
          The certificate password has already been revealed. If you need a new invite, use the link in your original
          invitation email.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.passwordSection}>
      <h2>Certificate Password</h2>
      <p className={styles.warningText}>
        Scratch to reveal your certificate password. Save it — you'll need it to install the certificate from your
        email.
      </p>
      {revealed && password ? (
        <div className={styles.passwordDisplay}>
          <code>{password}</code>
          <Button
            className={styles.btnSmall}
            onClick={() => {
              navigator.clipboard.writeText(password)
              setCopied(true)
              if (timerRef.current) clearTimeout(timerRef.current)
              timerRef.current = setTimeout(() => setCopied(false), 2000)
            }}
          >
            {copied ? "Copied!" : "Copy"}
          </Button>
        </div>
      ) : (
        <ScratchCard width={320} height={48} onReveal={handleReveal}>
          <div className={styles.passwordPlaceholder}>
            <code>{"•".repeat(32)}</code>
          </div>
        </ScratchCard>
      )}
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
            It looks like your certificate isn't installed yet. Install the .p12 file from your email, then refresh this
            page.
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

      <Field.Root className={styles.formGroup}>
        <Field.Label className={styles.label}>Username</Field.Label>
        <Input
          name="username"
          required
          pattern="^[a-zA-Z0-9_-]{3,32}$"
          placeholder="Choose a username"
          className={styles.input}
          autoComplete="username"
        />
        <Field.Description className={styles.hint}>
          3-32 characters: letters, numbers, hyphens, underscores
        </Field.Description>
        <Field.Error className={styles.fieldError} />
      </Field.Root>

      <Field.Root className={styles.formGroup}>
        <Field.Label className={styles.label}>Password</Field.Label>
        <Input
          name="password"
          type="password"
          required
          minLength={12}
          placeholder="Choose a strong password"
          className={styles.input}
          autoComplete="new-password"
        />
        <Field.Description className={styles.hint}>At least 12 characters</Field.Description>
        <Field.Error className={styles.fieldError} />
      </Field.Root>

      <Field.Root className={styles.formGroup}>
        <Field.Label className={styles.label}>Confirm Password</Field.Label>
        <Input
          name="confirmPassword"
          type="password"
          required
          minLength={12}
          placeholder="Confirm your password"
          className={styles.input}
          autoComplete="new-password"
        />
        <Field.Error className={styles.fieldError} />
      </Field.Root>

      <Button type="submit" disabled={isSubmitting} className={`${shared.btn} ${shared.btnPrimary} ${shared.btnFull}`}>
        {isSubmitting ? "Creating Account..." : "Create Account"}
      </Button>
    </form>
  )
}
