import { useCallback, useState, useEffect, useRef } from "react"
import { redirect, useParams } from "react-router"
import { useTranslation } from "react-i18next"
import type { Route } from "./+types/invite"
import { runEffect } from "~/lib/runtime.server"
import { InviteRepo } from "~/lib/services/InviteRepo.server"
import { CertManager } from "~/lib/services/CertManager.server"
import { config } from "~/lib/config.server"
import { hashToken } from "~/lib/crypto.server"
import { resolveLocale, localeCookieHeader } from "~/lib/i18n.server"
import { Effect } from "effect"
import { ScratchCard } from "~/components/ScratchCard/ScratchCard"
import { CenteredCardPage } from "~/components/CenteredCardPage/CenteredCardPage"
import { ErrorCard } from "~/components/ErrorCard/ErrorCard"
import { Alert, Button, Heading, Input, InputGroup, Text } from "@duro-app/ui"
import styles from "./invite.module.css"

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

  // CSRF: verify origin
  const origin = request.headers.get("Origin")
  if (origin && !origin.endsWith(config.allowedOriginSuffix)) {
    return { error: "Invalid request origin" }
  }

  const formData = await request.formData()
  const intent = formData.get("intent") as string | null

  // Mark password as revealed (but don't consume — consumed on create-account)
  if (intent === "reveal") {
    return { revealed: true }
  }

  return { error: "Unknown action" }
}

let certCheckCount = 0

function checkCert(healthUrl: string): Promise<boolean> {
  certCheckCount++
  if (import.meta.env.DEV && !import.meta.env.VITEST && certCheckCount > 1) {
    return Promise.resolve(true)
  }
  return fetch(healthUrl, { mode: "cors" })
    .then((r) => r.ok)
    .catch(() => false)
}

export default function InvitePage({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const [certStatus, setCertStatus] = useState<"checking" | "installed" | "not-installed">("checking")

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
      <Heading level={1}>{t("invite.title", { appName: loaderData.appName })}</Heading>
      <p
        className={styles.subtitle}
        dangerouslySetInnerHTML={{ __html: t("invite.subtitle", { email: loaderData.email }) }}
      />

      {loaderData.groupNames && loaderData.groupNames.length > 0 && (
        <Text variant="bodySm" color="muted" as="p">
          {t("invite.groupsLabel", { groups: loaderData.groupNames.join(", ") })}
        </Text>
      )}

      {/* P12 Password Section */}
      <PasswordReveal p12Password={loaderData.p12Password} />

      {/* Cert Check */}
      <CertCheck status={certStatus} onRecheck={recheck} />

      {/* Error */}
      {actionData && "error" in actionData && <Alert variant="error">{actionData.error}</Alert>}
    </CenteredCardPage>
  )
}

function PasswordReveal({ p12Password }: { p12Password: string | null }) {
  const { t } = useTranslation()
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null)

  useEffect(() => {
    try {
      if (localStorage.getItem(`scratch:${window.location.pathname}`) === "1") {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reading from localStorage
        setRevealed(true)
      }
    } catch {
      // localStorage may be unavailable in private browsing
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const handleReveal = () => {
    setRevealed(true)
    try {
      localStorage.setItem(`scratch:${window.location.pathname}`, "1")
    } catch {
      // localStorage may be unavailable in private browsing
    }
  }

  if (!p12Password) {
    return (
      <div className={styles.section}>
        <Alert variant="info">
          <Heading level={2} variant="headingSm">
            {t("invite.password.title")}
          </Heading>
          <p>{t("invite.password.consumed")}</p>
        </Alert>
      </div>
    )
  }

  return (
    <div className={styles.section}>
      <Alert variant="info">
        <Heading level={2} variant="headingSm">
          {t("invite.password.title")}
        </Heading>
        <p>{t("invite.password.warning")}</p>
        <InputGroup.Root>
          <ScratchCard width={320} height={48} onReveal={handleReveal} className={styles.scratchInline}>
            <Input defaultValue={p12Password} />
          </ScratchCard>
          <InputGroup.Addon
            disabled={!revealed}
            onClick={() => {
              navigator.clipboard.writeText(p12Password)
              setCopied(true)
              if (timerRef.current) clearTimeout(timerRef.current)
              timerRef.current = setTimeout(() => setCopied(false), 2000)
            }}
          >
            {copied ? t("invite.password.copied") : t("invite.password.copy")}
          </InputGroup.Addon>
        </InputGroup.Root>
        <div style={!revealed ? { visibility: "hidden" } : undefined}>
          <p>{t("invite.password.oneTime")}</p>
        </div>
      </Alert>
    </div>
  )
}

function CertCheck({
  status,
  onRecheck,
}: {
  status: "checking" | "installed" | "not-installed"
  onRecheck: () => void
}) {
  const { t } = useTranslation()
  const { token } = useParams()
  const installed = status === "installed"

  return (
    <>
      <div className={styles.certCheck}>
        <Alert variant={installed ? "success" : "warning"}>
          {installed ? (
            <p>{t("invite.cert.detected")}</p>
          ) : (
            <div className={styles.certWarningContent}>
              <p className={status === "checking" ? styles.certTextHidden : undefined}>
                {t("invite.cert.notInstalled")}
              </p>
              <p className={status === "checking" ? styles.certTextHidden : styles.certHint}>{t("invite.cert.hint")}</p>
              <button
                type="button"
                onClick={onRecheck}
                className={styles.btnRetry}
                disabled={status === "checking"}
                tabIndex={status === "checking" ? -1 : undefined}
              >
                {status === "checking" ? t("invite.cert.checking") : t("invite.cert.retry")}
              </button>
            </div>
          )}
        </Alert>
      </div>
      {installed ? (
        <a href={`/invite/${token}/create-account`} className={styles.continueLink}>
          {t("invite.cert.continue")}
        </a>
      ) : (
        <Button fullWidth disabled>
          {t("invite.cert.continue")}
        </Button>
      )}
    </>
  )
}
