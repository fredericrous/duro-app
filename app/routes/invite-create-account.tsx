import { Suspense, use, useState } from "react"
import { redirect, useNavigation } from "react-router"
import { useTranslation } from "react-i18next"
import type { Route } from "./+types/invite-create-account"
import { runEffect } from "~/lib/runtime.server"
import { InviteRepo } from "~/lib/services/InviteRepo.server"
import { CertManager } from "~/lib/services/CertManager.server"
import { acceptInvite } from "~/lib/workflows/invite.server"
import { hashToken } from "~/lib/crypto.server"
import { Effect } from "effect"
import { CenteredCardPage } from "~/components/CenteredCardPage/CenteredCardPage"
import { ErrorCard } from "~/components/ErrorCard/ErrorCard"
import { Alert, Button, Field, Heading, Input } from "@duro-app/ui"
import { config } from "~/lib/config.server"
import { resolveLocale, localeCookieHeader } from "~/lib/i18n.server"
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
        const inv = yield* repo.findByTokenHash(tokenHash)
        if (inv) {
          // Consume the P12 password now that the user has reached create-account
          const cert = yield* CertManager
          yield* cert.consumeP12Password(inv.id).pipe(Effect.ignore)
        }
        return inv
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
  const [certPromise] = useState(() => {
    if (typeof window === "undefined") return Promise.resolve(false)
    return checkCert(loaderData.healthUrl)
  })

  if (!loaderData.valid) {
    return <ErrorCard title={t("createAccount.heading")} message={loaderData.error} />
  }

  return (
    <CenteredCardPage>
      <Heading level={1}>{t("createAccount.heading")}</Heading>
      <p
        className={styles.subtitle}
        dangerouslySetInnerHTML={{ __html: t("createAccount.subtitle", { email: loaderData.email }) }}
      />

      <Suspense fallback={<p className={styles.checkingCert}>{t("createAccount.certCheck")}</p>}>
        <CertGate certPromise={certPromise} actionData={actionData} />
      </Suspense>
    </CenteredCardPage>
  )
}

function CertGate({
  certPromise,
  actionData,
}: {
  certPromise: Promise<boolean>
  actionData: Route.ComponentProps["actionData"]
}) {
  const { t } = useTranslation()
  const navigation = useNavigation()
  const isSubmitting = navigation.state === "submitting"
  const certInstalled = use(certPromise)

  if (!certInstalled) {
    return (
      <Alert variant="warning">
        <Heading level={2} variant="headingSm">
          {t("createAccount.certRequired.title")}
        </Heading>
        <p>{t("createAccount.certRequired.message")}</p>
        <a href=".." className={styles.certBackLink}>
          {t("createAccount.certRequired.back")}
        </a>
      </Alert>
    )
  }

  return (
    <>
      {actionData && "error" in actionData && <Alert variant="error">{actionData.error}</Alert>}

      <form method="post" className={styles.accountForm}>
        <fieldset disabled={isSubmitting}>
          <Field.Root>
            <Field.Label>{t("createAccount.username.label")}</Field.Label>
            <Input
              name="username"
              required
              pattern="^[a-zA-Z0-9_-]{3,32}$"
              placeholder={t("createAccount.username.placeholder")}
              autoComplete="username"
            />
            <Field.Description>{t("createAccount.username.hint")}</Field.Description>
          </Field.Root>

          <Field.Root>
            <Field.Label>{t("createAccount.password.label")}</Field.Label>
            <Input
              name="password"
              type="password"
              required
              minLength={12}
              placeholder={t("createAccount.password.placeholder")}
              autoComplete="new-password"
            />
            <Field.Description>{t("createAccount.password.hint")}</Field.Description>
          </Field.Root>

          <Field.Root>
            <Field.Label>{t("createAccount.confirm.label")}</Field.Label>
            <Input
              name="confirmPassword"
              type="password"
              required
              minLength={12}
              placeholder={t("createAccount.confirm.placeholder")}
              autoComplete="new-password"
            />
          </Field.Root>

          <Button type="submit" variant="primary" fullWidth disabled={isSubmitting}>
            {isSubmitting ? t("createAccount.submitting") : t("createAccount.submit")}
          </Button>
        </fieldset>
      </form>
    </>
  )
}
