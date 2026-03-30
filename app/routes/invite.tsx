import { useCallback, useState, useEffect } from "react"
import { redirect } from "react-router"
import { Trans, useTranslation } from "react-i18next"
import type { Route } from "./+types/invite"
import { runEffect } from "~/lib/runtime.server"
import { InviteRepo } from "~/lib/services/InviteRepo.server"
import { CertManager } from "~/lib/services/CertManager.server"
import { config, isOriginAllowed } from "~/lib/config.server"
import { hashToken } from "~/lib/crypto.server"
import { resolveLocale, localeCookieHeader } from "~/lib/i18n.server"
import { Effect } from "effect"
import { CenteredCardPage } from "~/components/CenteredCardPage/CenteredCardPage"
import { ErrorCard } from "~/components/ErrorCard/ErrorCard"
import { InvitePasswordReveal } from "~/components/InvitePasswordReveal/InvitePasswordReveal"
import { CertCheck } from "~/components/CertCheck/CertCheck"
import { useDevOverrides } from "~/components/DevToolbar/DevToolbar"
import { Heading, Stack, Text } from "@duro-app/ui"

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.appName ? `Join ${data.appName}` : "Join" }]
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

    const { invite, p12Password } = await runEffect(
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const cert = yield* CertManager
        const invite = yield* repo.findByTokenHash(tokenHash)
        const p12Password = invite ? yield* cert.getP12Password(invite.id) : null
        return { invite, p12Password }
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
      }
    }

    if (new Date(invite.expiresAt) < new Date()) {
      return {
        valid: false as const,
        error: "expired",
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
      groupNames: JSON.parse(invite.groupNames) as string[],
      p12Password,
      appName: config.appName,
      healthUrl: `${config.homeUrl}/health`,
    }
  } catch (e) {
    if (e instanceof Response) throw e
    console.error("[invite] loader error:", e)
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
  const intent = formData.get("intent") as string | null

  if (intent === "reveal") {
    return { revealed: true }
  }

  return { error: "Unknown action" }
}

function checkCert(healthUrl: string): Promise<boolean> {
  return fetch(healthUrl, { mode: "cors" })
    .then((r) => r.ok)
    .catch(() => false)
}

export default function InvitePage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const devOverrides = useDevOverrides()
  const [certStatus, setCertStatus] = useState<"checking" | "installed" | "not-installed">("checking")

  const effectiveCertStatus = devOverrides?.certInstalled ? "installed" : certStatus
  const { healthUrl } = loaderData

  const recheck = useCallback(() => {
    setCertStatus("checking")
    checkCert(healthUrl).then((ok) => setCertStatus(ok ? "installed" : "not-installed"))
  }, [healthUrl])

  useEffect(() => {
    let cancelled = false
    checkCert(healthUrl).then((ok) => {
      if (!cancelled) setCertStatus(ok ? "installed" : "not-installed")
    })
    return () => {
      cancelled = true
    }
  }, [healthUrl])

  if (!loaderData.valid) {
    const { error } = loaderData

    if (error === "expired") {
      return <ErrorCard icon="clock" title={t("invite.expired.title")} message={t("invite.expired.message")} />
    }

    if (error === "already_used") {
      return <ErrorCard icon="check-done" title={t("invite.used.title")} message={t("invite.used.message")} />
    }

    return <ErrorCard title={t("invite.error.title")} message={error} />
  }

  return (
    <CenteredCardPage>
      <Stack gap="lg">
        <Stack gap="sm">
          <Heading level={1}>{t("invite.title", { appName: loaderData.appName })}</Heading>
          <Text as="p" color="muted">
            <Trans i18nKey="invite.subtitle" values={{ email: loaderData.email }} components={{ strong: <strong /> }} />
          </Text>

          {loaderData.groupNames?.length > 0 && (
            <Text variant="bodySm" color="muted" as="p">
              {t("invite.groupsLabel", { groups: loaderData.groupNames.join(", ") })}
            </Text>
          )}
        </Stack>

        {effectiveCertStatus !== "installed" && <InvitePasswordReveal p12Password={loaderData.p12Password} />}
        <CertCheck status={effectiveCertStatus} onRecheck={recheck} />
      </Stack>
    </CenteredCardPage>
  )
}
