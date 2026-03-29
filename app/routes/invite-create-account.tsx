import { Suspense, useMemo, useState } from "react"
import { redirect } from "react-router"
import { Trans, useTranslation } from "react-i18next"
import type { Route } from "./+types/invite-create-account"
import { runEffect } from "~/lib/runtime.server"
import { InviteRepo } from "~/lib/services/InviteRepo.server"
import { CertManager } from "~/lib/services/CertManager.server"
import { config, isOriginAllowed } from "~/lib/config.server"
import { hashToken } from "~/lib/crypto.server"
import { resolveLocale, localeCookieHeader } from "~/lib/i18n.server"
import { acceptInvite } from "~/lib/workflows/invite.server"
import { Effect } from "effect"
import { CenteredCardPage } from "~/components/CenteredCardPage/CenteredCardPage"
import { ErrorCard } from "~/components/ErrorCard/ErrorCard"
import { CertGate } from "~/components/CertGate/CertGate"
import { useDevOverrides } from "~/components/DevToolbar/DevToolbar"
import { Alert, Heading, LinkButton, Text } from "@duro-app/ui"

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

  const origin = request.headers.get("Origin")
  if (!isOriginAllowed(origin)) {
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
    return { success: true as const, username, homeUrl: config.homeUrl }
  } catch (e) {
    if (e instanceof Response) throw e
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
  const devOverrides = useDevOverrides()
  const [realCertPromise] = useState(() => {
    if (typeof window === "undefined") return Promise.resolve(false)
    return checkCert(loaderData.healthUrl)
  })
  const certPromise = useMemo(
    () => (devOverrides?.certInstalled ? Promise.resolve(true) : realCertPromise),
    [devOverrides?.certInstalled, realCertPromise],
  )

  if (actionData && "success" in actionData && actionData.success) {
    return (
      <CenteredCardPage>
        <Heading level={1}>{t("createAccount.success.title")}</Heading>
        <Alert variant="success">
          <Text as="p">{t("createAccount.success.message")}</Text>
        </Alert>
        <LinkButton href={actionData.homeUrl} variant="primary" fullWidth>
          {t("createAccount.success.goHome")}
        </LinkButton>
      </CenteredCardPage>
    )
  }

  if (!loaderData.valid) {
    if (loaderData.error === "already_used") {
      return (
        <CenteredCardPage>
          <Heading level={1}>{t("createAccount.success.title")}</Heading>
          <Alert variant="success">
            <Text as="p">{t("createAccount.success.message")}</Text>
          </Alert>
          <LinkButton href={loaderData.homeUrl ?? "/"} variant="primary" fullWidth>
            {t("createAccount.success.goHome")}
          </LinkButton>
        </CenteredCardPage>
      )
    }
    return <ErrorCard title={t("createAccount.heading")} message={loaderData.error} />
  }

  return (
    <CenteredCardPage>
      <Heading level={1}>{t("createAccount.heading")}</Heading>
      <Text as="p" color="muted">
        <Trans
          i18nKey="createAccount.subtitle"
          values={{ email: loaderData.email }}
          components={{ strong: <strong /> }}
        />
      </Text>
      <Suspense
        fallback={
          <Text as="p" color="muted" variant="bodySm">
            {t("createAccount.certCheck")}
          </Text>
        }
      >
        <CertGate certPromise={certPromise} actionData={actionData} />
      </Suspense>
    </CenteredCardPage>
  )
}
