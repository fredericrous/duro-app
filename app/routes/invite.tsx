import { useCallback, useState, useEffect } from "react"
import { html } from "react-strict-dom"
import { redirect, useParams } from "react-router"
import { Trans, useTranslation } from "react-i18next"
import type { Route } from "./+types/invite"
import { runEffect } from "~/lib/runtime.server"
import { InviteRepo, isConsumed } from "~/lib/services/InviteRepo.server"
import { CertManager } from "~/lib/services/CertManager.server"
import { config, isOriginAllowed } from "~/lib/config.server"
import { hashToken } from "~/lib/crypto.server"
import { resolveLocale, localeCookieHeader } from "~/lib/i18n.server"
import { certPlatform, certStore, chromeIntentUrl } from "~/lib/cert-store"
import { Effect } from "effect"
import { CenteredCardPage } from "~/components/CenteredCardPage/CenteredCardPage"
import { ErrorCard } from "~/components/ErrorCard/ErrorCard"
import { InvitePasswordReveal } from "~/components/InvitePasswordReveal/InvitePasswordReveal"
import { CertCheck } from "~/components/CertCheck/CertCheck"
import { useDevOverrides } from "~/components/DevToolbar/DevToolbar"
import { Heading, LinkButton, Stack, Text } from "@duro-app/ui"

type InviteErrorCode =
  | "missing_token"
  | "invalid"
  | "already_used"
  | "revoked"
  | "expired"
  | "too_many_attempts"
  | "unknown"

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.appName ? `Join ${data.appName}` : "Join" }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const token = params.token
  const healthUrl = `${config.homeUrl}/health`
  // Read off the User-Agent, not the probe: a browser with no certificate
  // store fails the probe exactly like one whose user hasn't installed theirs
  // yet, and only the UA can tell the page which of the two it is looking at.
  const userAgent = request.headers.get("user-agent")
  const store = certStore(userAgent)
  const platform = certPlatform(userAgent)
  const inviteUrl = token ? `${config.inviteBaseUrl}/invite/${token}` : null
  const browser = {
    store,
    onIos: platform === "ios",
    installKey: platform ? (`certInstall.${platform}` as const) : null,
    inviteUrl,
    // An escape hatch only for browsers that need one. Only Android has an
    // intent: scheme that can hand a URL to a named browser; everywhere else
    // the copyable link is the whole of it.
    chromeUrl: store === "none" && platform === "android" && inviteUrl ? chromeIntentUrl(inviteUrl) : null,
  }
  if (!token) {
    return {
      valid: false as const,
      error: "missing_token" as InviteErrorCode,
      appName: config.appName,
      healthUrl,
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
      }).pipe(Effect.orDie),
    )
    // The password itself never leaves through the loader (GETs are
    // prefetchable, cacheable, and SSR-serialized) — only its existence does.
    // Disclosure happens in the reveal POST below.

    if (!invite) {
      return {
        valid: false as const,
        error: "invalid" as InviteErrorCode,
        appName: config.appName,
        healthUrl,
      }
    }

    const currentLocale = resolveLocale(request)
    if (invite.locale && invite.locale !== currentLocale) {
      throw redirect(request.url, {
        headers: { "Set-Cookie": localeCookieHeader(invite.locale) },
      })
    }

    if (invite.status._tag === "Accepted") {
      // The account exists, so this link has nothing left to offer — send them
      // to the app itself (which puts them through login) rather than a
      // dead-end card. Someone re-opening an old invite link is trying to get
      // in, not to read about having already joined.
      throw redirect(config.homeUrl)
    }

    if (isConsumed(invite.status)) {
      // Revoked / mid-revocation: there is no account to reach, so an
      // explanation is the only honest thing to show.
      return {
        valid: false as const,
        error: "revoked" as InviteErrorCode,
        appName: config.appName,
        healthUrl,
      }
    }

    if (new Date(invite.expiresAt) < new Date()) {
      return {
        valid: false as const,
        error: "expired" as InviteErrorCode,
        appName: config.appName,
        healthUrl,
      }
    }

    if (invite.attempts >= 5) {
      return {
        valid: false as const,
        error: "too_many_attempts" as InviteErrorCode,
        appName: config.appName,
        healthUrl,
      }
    }

    return {
      valid: true as const,
      email: invite.email,
      groupNames: JSON.parse(invite.groupNames) as string[],
      hasPassword: p12Password !== null,
      appName: config.appName,
      healthUrl,
      browser,
    }
  } catch (e) {
    if (e instanceof Response) throw e
    console.error("[invite] loader error:", e)
    return {
      valid: false as const,
      error: "unknown" as InviteErrorCode,
      appName: config.appName,
      healthUrl,
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
    // Hand the password out ONLY here, to a same-origin, user-initiated POST
    // against a still-valid invite — never in loader (GET) data. Re-check
    // validity: the action must not become a side door around the loader's
    // consumed/expired/attempts gates.
    const tokenHash = hashToken(token)
    const p12Password = await runEffect(
      Effect.gen(function* () {
        const repo = yield* InviteRepo
        const cert = yield* CertManager
        const invite = yield* repo.findByTokenHash(tokenHash)
        if (!invite || isConsumed(invite.status)) return null
        if (new Date(invite.expiresAt) < new Date()) return null
        if (invite.attempts >= 5) return null
        return yield* cert.getP12Password(invite.id)
      }).pipe(Effect.orDie),
    )
    return { revealed: p12Password !== null, p12Password }
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
  const params = useParams()
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
      return (
        <ErrorCard
          icon="clock"
          tone="warning"
          title={t("invite.expired.title")}
          message={t("invite.expired.message")}
          action={
            params.token ? (
              <LinkButton href={`/reinvite/${params.token}`} variant="primary" fullWidth>
                {t("invite.expired.cta")}
              </LinkButton>
            ) : null
          }
        />
      )
    }

    if (error === "already_used" || error === "revoked") {
      return (
        <ErrorCard
          icon="check-done"
          tone="info"
          title={t("invite.revoked.title")}
          message={t("invite.revoked.message")}
        />
      )
    }

    const messageKey =
      error === "missing_token"
        ? "invite.error.missingToken"
        : error === "invalid"
          ? "invite.error.invalid"
          : error === "too_many_attempts"
            ? "invite.error.tooManyAttempts"
            : "invite.error.unknown"

    return <ErrorCard title={t("invite.error.title")} message={t(messageKey)} />
  }

  const { browser } = loaderData

  return (
    <CenteredCardPage>
      <Stack gap="lg">
        <Stack gap="sm">
          <Heading level={1}>{t("invite.title", { appName: loaderData.appName })}</Heading>
          <Text as="p" color="muted">
            <Trans
              i18nKey="invite.subtitle"
              values={{ email: loaderData.email }}
              components={{ strong: <html.strong /> }}
            />
          </Text>

          {loaderData.groupNames?.length > 0 && (
            <Text variant="bodySm" color="muted" as="p">
              {t("invite.groupsLabel", { groups: loaderData.groupNames.join(", ") })}
            </Text>
          )}
        </Stack>

        {effectiveCertStatus !== "installed" && browser.store !== "none" && (
          <Stack gap="md">
            <LinkButton href={`/invite/${params.token}/download`} variant="primary" fullWidth>
              {t("invite.download.button")}
            </LinkButton>
            {/* The steps for THIS device only. The email has to list every
                platform because it cannot know where it will be opened; this
                page can, and a single correct instruction beats four that the
                reader has to sort through on a phone. */}
            {browser.installKey ? (
              <Text as="p" color="muted" variant="bodySm">
                <Trans i18nKey={browser.installKey} components={{ strong: <html.strong /> }} />
              </Text>
            ) : null}
            <InvitePasswordReveal hasPassword={loaderData.hasPassword} />
          </Stack>
        )}
        <CertCheck
          status={effectiveCertStatus}
          onRecheck={recheck}
          store={browser.store}
          onIos={browser.onIos}
          inviteUrl={browser.inviteUrl ?? undefined}
          chromeUrl={browser.chromeUrl}
        />
      </Stack>
    </CenteredCardPage>
  )
}
