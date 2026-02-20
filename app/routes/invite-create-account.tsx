import { useState, useEffect } from "react"
import { redirect, useNavigation } from "react-router"
import type { Route } from "./+types/invite-create-account"
import { runEffect } from "~/lib/runtime.server"
import { InviteRepo } from "~/lib/services/InviteRepo.server"
import { acceptInvite } from "~/lib/workflows/invite.server"
import { hashToken } from "~/lib/crypto.server"
import { Effect } from "effect"
import { Button } from "@base-ui/react/button"
import { Field } from "@base-ui/react/field"
import { Input } from "@base-ui/react/input"
import shared from "./shared.module.css"
import styles from "./invite-create-account.module.css"

export function meta() {
  return [{ title: "Create Account — Daddyshome" }]
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

        const invite = yield* repo.findByTokenHash(tokenHash)
        if (!invite) {
          return { valid: false as const, error: "Invalid invite link" }
        }

        if (invite.usedAt) {
          return { valid: false as const, error: "This invite has already been used." }
        }

        if (new Date(invite.expiresAt) < new Date()) {
          return { valid: false as const, error: "This invite has expired." }
        }

        if (invite.attempts >= 5) {
          return { valid: false as const, error: "Too many attempts. Please contact an administrator." }
        }

        return {
          valid: true as const,
          email: invite.email,
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
  const username = (formData.get("username") as string)?.trim()
  const password = formData.get("password") as string
  const confirmPassword = formData.get("confirmPassword") as string

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

export default function CreateAccountPage({ loaderData, actionData }: Route.ComponentProps) {
  const [certInstalled, setCertInstalled] = useState<boolean | null>(null)
  const navigation = useNavigation()
  const isSubmitting = navigation.state === "submitting"

  useEffect(() => {
    checkCert().then(setCertInstalled)
  }, [])

  if (!loaderData.valid) {
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
          <h1>Unable to Create Account</h1>
          <p className={styles.errorMessage}>{loaderData.error}</p>
        </div>
      </main>
    )
  }

  // Still checking cert
  if (certInstalled === null) {
    return (
      <main className={shared.page}>
        <div className={shared.card}>
          <h1>Create Your Account</h1>
          <p className={styles.subtitle}>
            Setting up for <strong>{loaderData.email}</strong>
          </p>
          <p className={styles.checkingCert}>Checking certificate...</p>
        </div>
      </main>
    )
  }

  // Cert not installed
  if (!certInstalled) {
    return (
      <main className={shared.page}>
        <div className={shared.card}>
          <div className={styles.certWarning}>
            <h2>Certificate Required</h2>
            <p>
              Your certificate isn't installed yet. Go back to install it first, then return here.
            </p>
            <a href=".." className={`${shared.btn} ${shared.btnPrimary}`}>
              Back to Invite
            </a>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className={shared.page}>
      <div className={shared.card}>
        <h1>Create Your Account</h1>
        <p className={styles.subtitle}>
          Setting up for <strong>{loaderData.email}</strong>
        </p>

        {actionData && "error" in actionData && <div className={shared.alertError}>{actionData.error}</div>}

        <form method="post" className={styles.accountForm}>
          <fieldset disabled={isSubmitting}>
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

            <Button
              type="submit"
              disabled={isSubmitting}
              className={`${shared.btn} ${shared.btnPrimary} ${shared.btnFull}`}
            >
              {isSubmitting ? "Creating Account..." : "Create Account"}
            </Button>
          </fieldset>
        </form>
      </div>
    </main>
  )
}
