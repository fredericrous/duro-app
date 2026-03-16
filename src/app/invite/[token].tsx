import { useCallback, useState, useEffect } from "react"
import { Trans, useTranslation } from "react-i18next"
import { useLoaderData } from "expo-router"
import type { LoaderFunction } from "expo-server"
import { Effect } from "effect"
import { devInviteFallback } from "../../server/dev-fallbacks"
import { CenteredCardPage } from "~/components/CenteredCardPage/CenteredCardPage"
import { ErrorCard } from "~/components/ErrorCard/ErrorCard"
import { InvitePasswordReveal } from "~/components/InvitePasswordReveal/InvitePasswordReveal"
import { CertCheck } from "~/components/CertCheck/CertCheck"
import { useDevOverrides } from "~/components/DevToolbar/DevToolbar"
import { Heading, Stack, Text } from "@duro-app/ui"

type InviteLoaderData =
  | { valid: false; error: string; appName: string; healthUrl: string }
  | { valid: true; email: string; groupNames: string[]; p12Password: string | null; appName: string; healthUrl: string }

export const loader: LoaderFunction<InviteLoaderData> = async (request, params) => {
  const { config } = require("~/lib/config.server")
  if (typeof config !== "object") return devInviteFallback

  const { hashToken } = require("~/lib/crypto.server")
  const { runEffect } = require("~/lib/runtime.server")
  const { InviteRepo } = require("~/lib/services/InviteRepo.server")
  const { CertManager } = require("~/lib/services/CertManager.server")
  const token = params.token as string | undefined
  if (!token) {
    return { valid: false, error: "Missing invite token", appName: config.appName, healthUrl: `${config.homeUrl}/health` }
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

    if (!invite)
      return { valid: false as const, error: "Invalid invite link", appName: config.appName, healthUrl: `${config.homeUrl}/health` }
    if (invite.usedAt)
      return { valid: false as const, error: "already_used", appName: config.appName, healthUrl: `${config.homeUrl}/health` }
    if (new Date(invite.expiresAt) < new Date())
      return { valid: false as const, error: "expired", appName: config.appName, healthUrl: `${config.homeUrl}/health` }
    if (invite.attempts >= 5)
      return { valid: false as const, error: "Too many attempts.", appName: config.appName, healthUrl: `${config.homeUrl}/health` }

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
    return { valid: false as const, error: "Something went wrong", appName: config.appName, healthUrl: `${config.homeUrl}/health` }
  }
}

function checkCert(healthUrl: string): Promise<boolean> {
  return fetch(healthUrl, { mode: "cors" })
    .then((r) => r.ok)
    .catch(() => false)
}

export default function InvitePage() {
  const { t } = useTranslation()
  const loaderData = useLoaderData<typeof loader>()
  const devOverrides = useDevOverrides()
  const [certStatus, setCertStatus] = useState<"checking" | "installed" | "not-installed">("checking")

  const effectiveCertStatus = devOverrides?.certInstalled ? "installed" : certStatus

  const recheck = useCallback(() => {
    setCertStatus("checking")
    checkCert(loaderData.healthUrl).then((ok) => setCertStatus(ok ? "installed" : "not-installed"))
  }, [loaderData.healthUrl])

  useEffect(() => {
    let cancelled = false
    checkCert(loaderData.healthUrl).then((ok) => {
      if (!cancelled) setCertStatus(ok ? "installed" : "not-installed")
    })
    return () => {
      cancelled = true
    }
  }, [loaderData.healthUrl])

  if (!loaderData.valid) {
    const { error } = loaderData
    if (error === "expired")
      return <ErrorCard icon="clock" title={t("invite.expired.title")} message={t("invite.expired.message")} />
    if (error === "already_used")
      return <ErrorCard icon="check-done" title={t("invite.used.title")} message={t("invite.used.message")} />
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

        <InvitePasswordReveal p12Password={loaderData.p12Password} />
        <CertCheck status={effectiveCertStatus} onRecheck={recheck} />
      </Stack>
    </CenteredCardPage>
  )
}
