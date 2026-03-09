import { Suspense, use, useState, useEffect, useRef } from "react"
import { redirect } from "react-router"
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
import { Alert, Button } from "@duro-app/ui"
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

function checkCert(healthUrl: string): Promise<boolean> {
  return fetch(healthUrl, { mode: "cors" })
    .then((r) => r.ok)
    .catch(() => false)
}

function buildCertCheckUrl(healthUrl: string): string {
  if (typeof window === "undefined") return healthUrl
  const returnTo = window.location.href
  return `${healthUrl}?return=${encodeURIComponent(returnTo)}`
}

export default function InvitePage({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const [certPromise] = useState(() => {
    if (typeof window === "undefined") return Promise.resolve(false)
    return checkCert(loaderData.healthUrl)
  })

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
      <h1>{t("invite.title", { appName: loaderData.appName })}</h1>
      <p
        className={styles.subtitle}
        dangerouslySetInnerHTML={{ __html: t("invite.subtitle", { email: loaderData.email }) }}
      />

      {loaderData.groupNames && loaderData.groupNames.length > 0 && (
        <p className={styles.groupsInfo}>{t("invite.groupsLabel", { groups: loaderData.groupNames.join(", ") })}</p>
      )}

      {/* P12 Password Section */}
      <PasswordReveal p12Password={loaderData.p12Password} />

      {/* Cert Check */}
      <Suspense fallback={<CertCheckLoading />}>
        <CertCheckResult certPromise={certPromise} healthUrl={loaderData.healthUrl} />
      </Suspense>

      {/* Error */}
      {actionData && "error" in actionData && <Alert variant="error">{actionData.error}</Alert>}
    </CenteredCardPage>
  )
}

function PasswordReveal({ p12Password }: { p12Password: string | null }) {
  const { t } = useTranslation()
  const [revealed, setRevealed] = useState(() => {
    if (typeof window === "undefined") return false
    try {
      return localStorage.getItem(`scratch:${window.location.pathname}`) === "1"
    } catch {
      return false
    }
  })
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null)

  useEffect(() => {
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
          <h2 className={styles.sectionTitle}>{t("invite.password.title")}</h2>
          <p>{t("invite.password.consumed")}</p>
        </Alert>
      </div>
    )
  }

  return (
    <div className={styles.section}>
      <Alert variant="info">
        <h2 className={styles.sectionTitle}>{t("invite.password.title")}</h2>
        <p>{t("invite.password.warning")}</p>
        <ScratchCard width={320} height={48} onReveal={handleReveal}>
          <div className={styles.passwordPlaceholder}>
            <code>{p12Password}</code>
          </div>
        </ScratchCard>
        <div style={!revealed ? { visibility: "hidden" } : undefined}>
          <div className={styles.passwordCopyRow}>
            <Button
              variant="secondary"
              size="small"
              onClick={() => {
                navigator.clipboard.writeText(p12Password)
                setCopied(true)
                if (timerRef.current) clearTimeout(timerRef.current)
                timerRef.current = setTimeout(() => setCopied(false), 2000)
              }}
            >
              {copied ? t("invite.password.copied") : t("invite.password.copy")}
            </Button>
          </div>
          <p>{t("invite.password.oneTime")}</p>
        </div>
      </Alert>
    </div>
  )
}

function CertCheckLoading() {
  const { t } = useTranslation()
  return (
    <div className={styles.certCheck}>
      <p className={`${styles.certStatus} ${styles.certStatusChecking}`}>{t("invite.cert.checking")}</p>
    </div>
  )
}

function CertCheckResult({ certPromise, healthUrl }: { certPromise: Promise<boolean>; healthUrl: string }) {
  const { t } = useTranslation()
  const installed = use(certPromise)

  return (
    <div className={styles.certCheck}>
      <Alert variant={installed ? "success" : "warning"}>
        {installed ? (
          <p>{t("invite.cert.detected")}</p>
        ) : (
          <div className={styles.certWarningContent}>
            <p>{t("invite.cert.notInstalled")}</p>
            <p className={styles.certHint}>{t("invite.cert.hint")}</p>
            <a href={buildCertCheckUrl(healthUrl)} className={styles.btnRetry}>
              {t("invite.cert.retry")}
            </a>
          </div>
        )}
      </Alert>
      {installed ? (
        <a href="create-account" className={styles.continueLink}>
          {t("invite.cert.continue")}
        </a>
      ) : (
        <Button fullWidth disabled>
          {t("invite.cert.continue")}
        </Button>
      )}
    </div>
  )
}
