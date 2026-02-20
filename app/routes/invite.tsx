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
import { Button } from "@base-ui/react/button"
import { ScratchCard } from "~/components/ScratchCard/ScratchCard"
import { CenteredCardPage } from "~/components/CenteredCardPage/CenteredCardPage"
import { ErrorCard } from "~/components/ErrorCard/ErrorCard"
import { Alert } from "~/components/Alert/Alert"
import shared from "./shared.module.css"
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

  // Handle scratch-to-reveal: consume password from Vault
  if (intent === "reveal") {
    try {
      const tokenHash = hashToken(token)
      const result = await runEffect(
        Effect.gen(function* () {
          const repo = yield* InviteRepo
          const invite = yield* repo.findByTokenHash(tokenHash)
          if (!invite) return { password: null }

          const cert = yield* CertManager
          const password = yield* cert.consumeP12Password(invite.id)
          return { password }
        }),
      )
      return result
    } catch (e) {
      console.error("[invite] reveal action error:", e)
      return { password: null }
    }
  }

  return { error: "Unknown action" }
}

function checkCert(healthUrl: string): Promise<boolean> {
  return fetch(healthUrl, { mode: "cors" })
    .then((r) => r.ok)
    .catch(() => false)
}

export default function InvitePage({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const [certPromise] = useState(() => checkCert(loaderData.healthUrl))

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
        <CertCheckResult certPromise={certPromise} />
      </Suspense>

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
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const handleReveal = () => {
    setRevealed(true)
    fetch("", {
      method: "POST",
      body: new URLSearchParams({ intent: "reveal" }),
    }).catch(() => {})
  }

  if (!p12Password) {
    return (
      <div className={styles.passwordSection}>
        <h2>{t("invite.password.title")}</h2>
        <p className={styles.infoText}>{t("invite.password.consumed")}</p>
      </div>
    )
  }

  return (
    <div className={styles.passwordSection}>
      <h2>{t("invite.password.title")}</h2>
      <p className={styles.warningText}>{t("invite.password.warning")}</p>
      <ScratchCard width={320} height={48} onReveal={handleReveal}>
        <div className={styles.passwordPlaceholder}>
          <code>{p12Password}</code>
        </div>
      </ScratchCard>
      {revealed && (
        <div className={styles.passwordCopyRow}>
          <Button
            className={styles.btnSmall}
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
      )}
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

function CertCheckResult({ certPromise }: { certPromise: Promise<boolean> }) {
  const { t } = useTranslation()
  const installed = use(certPromise)

  return (
    <div className={styles.certCheck}>
      {installed ? (
        <>
          <p className={`${styles.certStatus} ${styles.certStatusSuccess}`}>{t("invite.cert.detected")}</p>
          <a href="create-account" className={`${shared.btn} ${shared.btnPrimary} ${shared.btnFull}`}>
            {t("invite.cert.continue")}
          </a>
        </>
      ) : (
        <div className={styles.certWarning}>
          <p>{t("invite.cert.notInstalled")}</p>
        </div>
      )}
    </div>
  )
}
