import { Suspense, useState } from "react"
import { redirect } from "react-router"
import { useTranslation } from "react-i18next"
import type { Route } from "./+types/invite-create-account"
import { runEffect } from "~/lib/runtime.server"
import { InviteRepo } from "~/lib/services/InviteRepo.server"
import { CertManager } from "~/lib/services/CertManager.server"
import { hashToken } from "~/lib/crypto.server"
import { Effect } from "effect"
import { handleCreateAccount, parseCreateAccountMutation } from "~/lib/mutations/create-account"
import { CenteredCardPage } from "~/components/CenteredCardPage/CenteredCardPage"
import { ErrorCard } from "~/components/ErrorCard/ErrorCard"
import { CertGate } from "~/components/CertGate/CertGate"
import { Alert, Heading } from "@duro-app/ui"
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
        error: "already_used",
        appName: config.appName,
        healthUrl: `${config.homeUrl}/health`,
        homeUrl: config.homeUrl,
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
  const parsed = parseCreateAccountMutation(formData as any, token)
  if ("error" in parsed) return parsed

  const result = await runEffect(handleCreateAccount(parsed))
  if ("_redirect" in result) {
    throw redirect(result._redirect)
  }
  return result
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
    if (loaderData.error === "already_used") {
      return (
        <CenteredCardPage>
          <Heading level={1}>{t("createAccount.success.title")}</Heading>
          <Alert variant="success">
            <p>{t("createAccount.success.message")}</p>
          </Alert>
          <a href={loaderData.homeUrl} className={styles.homeLink}>
            {t("createAccount.success.goHome")}
          </a>
        </CenteredCardPage>
      )
    }
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
