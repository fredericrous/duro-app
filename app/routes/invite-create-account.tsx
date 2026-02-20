import { useState, useEffect } from "react"
import { redirect, useNavigation } from "react-router"
import { useTranslation } from "react-i18next"
import type { Route } from "./+types/invite-create-account"
import { runEffect } from "~/lib/runtime.server"
import { InviteRepo } from "~/lib/services/InviteRepo.server"
import { acceptInvite } from "~/lib/workflows/invite.server"
import { hashToken } from "~/lib/crypto.server"
import { Effect } from "effect"
import { Button } from "@base-ui/react/button"
import { Field } from "@base-ui/react/field"
import { Input } from "@base-ui/react/input"
import { CenteredCardPage } from "~/components/CenteredCardPage/CenteredCardPage"
import { ErrorCard } from "~/components/ErrorCard/ErrorCard"
import { Alert } from "~/components/Alert/Alert"
import { config } from "~/lib/config.server"
import { resolveLocale, localeCookieHeader } from "~/lib/i18n.server"
import shared from "./shared.module.css"
import styles from "./invite-create-account.module.css"

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.appName ? `Create Account — ${data.appName}` : "Create Account" }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const token = params.token
  if (!token) {
    return {
      valid: false as const,
      error: "Missing invite token",
      appName: config.appName,
      healthUrl: `${config.homeUrl}/health`,
    }
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
      return {
        valid: false as const,
        error: "Invalid invite link",
        appName: config.appName,
        healthUrl: `${config.homeUrl}/health`,
      }
    }

    // Set locale cookie from invite if different from current
    const currentLocale = resolveLocale(request)
    if (invite.locale && invite.locale !== currentLocale) {
      throw redirect(request.url, {
        headers: { "Set-Cookie": localeCookieHeader(invite.locale) },
      })
    }

    if (invite.usedAt) {
      return {
        valid: false as const,
        error: "This invite has already been used.",
        appName: config.appName,
        healthUrl: `${config.homeUrl}/health`,
      }
    }

    if (new Date(invite.expiresAt) < new Date()) {
      return {
        valid: false as const,
        error: "This invite has expired.",
        appName: config.appName,
        healthUrl: `${config.homeUrl}/health`,
      }
    }

    if (invite.attempts >= 5) {
      return {
        valid: false as const,
        error: "Too many attempts. Please contact an administrator.",
        appName: config.appName,
        healthUrl: `${config.homeUrl}/health`,
      }
    }

    return {
      valid: true as const,
      email: invite.email,
      appName: config.appName,
      healthUrl: `${config.homeUrl}/health`,
    }
  } catch (e) {
    if (e instanceof Response) throw e
    console.error("[create-account] loader error:", e)
    return {
      valid: false as const,
      error: "Something went wrong",
      appName: config.appName,
      healthUrl: `${config.homeUrl}/health`,
    }
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const token = params.token
  if (!token) {
    return { error: "Missing invite token" }
  }

  // CSRF: verify origin
  const origin = request.headers.get("Origin")
  if (origin && !origin.endsWith(config.allowedOriginSuffix)) {
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
    return redirect(`${config.homeUrl}/welcome`)
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to create account"
    return { error: message }
  }
}

function checkCert(healthUrl: string): Promise<boolean> {
  return fetch(healthUrl, { mode: "cors" })
    .then((r) => r.ok)
    .catch(() => false)
}

export default function CreateAccountPage({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const [certInstalled, setCertInstalled] = useState<boolean | null>(null)
  const { healthUrl } = loaderData
  const navigation = useNavigation()
  const isSubmitting = navigation.state === "submitting"

  useEffect(() => {
    checkCert(healthUrl).then(setCertInstalled)
  }, [])

  if (!loaderData.valid) {
    return <ErrorCard title={t("createAccount.heading")} message={loaderData.error} />
  }

  // Still checking cert
  if (certInstalled === null) {
    return (
      <CenteredCardPage>
        <h1>{t("createAccount.heading")}</h1>
        <p
          className={styles.subtitle}
          dangerouslySetInnerHTML={{ __html: t("createAccount.subtitle", { email: loaderData.email }) }}
        />
        <p className={styles.checkingCert}>{t("createAccount.certCheck")}</p>
      </CenteredCardPage>
    )
  }

  // Cert not installed
  if (!certInstalled) {
    return (
      <CenteredCardPage>
        <div className={styles.certWarning}>
          <h2>{t("createAccount.certRequired.title")}</h2>
          <p>{t("createAccount.certRequired.message")}</p>
          <a href=".." className={`${shared.btn} ${shared.btnPrimary}`}>
            {t("createAccount.certRequired.back")}
          </a>
        </div>
      </CenteredCardPage>
    )
  }

  return (
    <CenteredCardPage>
      <h1>{t("createAccount.heading")}</h1>
      <p
        className={styles.subtitle}
        dangerouslySetInnerHTML={{ __html: t("createAccount.subtitle", { email: loaderData.email }) }}
      />

      {actionData && "error" in actionData && <Alert variant="error">{actionData.error}</Alert>}

      <form method="post" className={styles.accountForm}>
        <fieldset disabled={isSubmitting}>
          <Field.Root className={styles.formGroup}>
            <Field.Label className={styles.label}>{t("createAccount.username.label")}</Field.Label>
            <Input
              name="username"
              required
              pattern="^[a-zA-Z0-9_-]{3,32}$"
              placeholder={t("createAccount.username.placeholder")}
              className={styles.input}
              autoComplete="username"
            />
            <Field.Description className={styles.hint}>{t("createAccount.username.hint")}</Field.Description>
            <Field.Error className={styles.fieldError} />
          </Field.Root>

          <Field.Root className={styles.formGroup}>
            <Field.Label className={styles.label}>{t("createAccount.password.label")}</Field.Label>
            <Input
              name="password"
              type="password"
              required
              minLength={12}
              placeholder={t("createAccount.password.placeholder")}
              className={styles.input}
              autoComplete="new-password"
            />
            <Field.Description className={styles.hint}>{t("createAccount.password.hint")}</Field.Description>
            <Field.Error className={styles.fieldError} />
          </Field.Root>

          <Field.Root className={styles.formGroup}>
            <Field.Label className={styles.label}>{t("createAccount.confirm.label")}</Field.Label>
            <Input
              name="confirmPassword"
              type="password"
              required
              minLength={12}
              placeholder={t("createAccount.confirm.placeholder")}
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
            {isSubmitting ? t("createAccount.submitting") : t("createAccount.submit")}
          </Button>
        </fieldset>
      </form>
    </CenteredCardPage>
  )
}
