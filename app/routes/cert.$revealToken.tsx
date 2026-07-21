import { useCallback, useRef, useState } from "react"
import { Trans, useTranslation } from "react-i18next"
import { useFetcher, useParams } from "react-router"
import type { Route } from "./+types/cert.$revealToken"
import { runEffect } from "~/lib/runtime.server"
import { CertRevealRepo } from "~/lib/services/CertRevealRepo.server"
import { CertManager } from "~/lib/services/CertManager.server"
import { config, isOriginAllowed } from "~/lib/config.server"
import { hashToken } from "~/lib/crypto.server"
import { Effect } from "effect"
import { CenteredCardPage } from "~/components/CenteredCardPage/CenteredCardPage"
import { ErrorCard } from "~/components/ErrorCard/ErrorCard"
import { useScratchReveal } from "~/hooks/useScratchReveal"
import { ScratchCard } from "~/components/ScratchCard/ScratchCard"
import { Heading, Input, InputGroup, LinkButton, Stack, Text } from "@duro-app/ui"

type CertRevealError = "invalid" | "expired" | "consumed" | "unknown"

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.appName ? `Your certificate — ${data.appName}` : "Your certificate" }]
}

/**
 * Resolve the reveal token to its current state. Shared by the loader, action
 * and download route. The loader/download only READ; the password is burned
 * (one-time) only on the explicit reveal POST, so a link-scanner's prefetch GET
 * cannot consume it. The cert (.p12) stays downloadable for the token's 24h
 * lifetime — it's the password that is single-use.
 */
const resolve = (revealToken: string) =>
  Effect.gen(function* () {
    const revealRepo = yield* CertRevealRepo
    const cert = yield* CertManager
    const row = yield* revealRepo.findByTokenHash(hashToken(revealToken))
    if (!row) return { state: "invalid" as const }
    if (new Date(row.expiresAt) < new Date()) return { state: "expired" as const, row }
    const password = yield* cert.getP12Password(row.renewalId)
    const p12 = yield* cert.getP12(row.renewalId)
    if (!password && !p12) return { state: "consumed" as const, row }
    // Password already burned but the cert is still downloadable.
    if (!password) return { state: "revealed" as const, row }
    return { state: "ok" as const, row, password }
  })

export async function loader({ params }: Route.LoaderArgs) {
  const revealToken = params.revealToken
  if (!revealToken) {
    return { valid: false as const, error: "invalid" as CertRevealError, appName: config.appName }
  }

  try {
    const result = await runEffect(resolve(revealToken))
    if (result.state === "ok") {
      return {
        valid: true as const,
        revealed: false as const,
        email: result.row.email,
        password: result.password,
        appName: config.appName,
      }
    }
    if (result.state === "revealed") {
      return { valid: true as const, revealed: true as const, email: result.row.email, appName: config.appName }
    }
    return { valid: false as const, error: result.state as CertRevealError, appName: config.appName }
  } catch (e) {
    console.error("[cert-reveal] loader error:", e)
    return { valid: false as const, error: "unknown" as CertRevealError, appName: config.appName }
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const revealToken = params.revealToken
  if (!revealToken) return { revealed: false as const }
  if (!isOriginAllowed(request.headers.get("Origin"))) return { revealed: false as const }

  const formData = await request.formData()
  if (formData.get("intent") !== "reveal") return { revealed: false as const }

  try {
    const consumed = await runEffect(
      Effect.gen(function* () {
        const revealRepo = yield* CertRevealRepo
        const cert = yield* CertManager
        const result = yield* resolve(revealToken)
        if (result.state !== "ok") return false
        // One-time password: stamp the audit timestamp and strip the password
        // from Vault. The .p12 bundle is left in place so it stays downloadable.
        yield* revealRepo.markRevealed(result.row.id)
        yield* cert.consumeP12Password(result.row.renewalId)
        return true
      }),
    )
    return { revealed: consumed }
  } catch (e) {
    console.error("[cert-reveal] action error:", e)
    return { revealed: false as const }
  }
}

function PasswordCard({ password }: { password: string }) {
  const { t } = useTranslation()
  const fetcher = useFetcher()
  const { revealed, onReveal } = useScratchReveal(
    `scratch:${typeof window !== "undefined" ? window.location.pathname : ""}`,
  )
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null)

  // Copy can reject (denied permission) or be unavailable entirely (insecure
  // context / older browser). Reflect the real outcome instead of always
  // claiming success, and fall back to a "copy it manually" hint.
  const copyPassword = useCallback(() => {
    const clip = typeof navigator !== "undefined" ? navigator.clipboard : undefined
    const flash = (setter: (v: boolean) => void, ms: number) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      setter(true)
      timerRef.current = setTimeout(() => setter(false), ms)
    }
    const onOk = () => {
      setCopyFailed(false)
      flash(setCopied, 2000)
    }
    const onFail = () => {
      setCopied(false)
      flash(setCopyFailed, 5000)
    }
    if (!clip?.writeText) {
      onFail()
      return
    }
    clip.writeText(password).then(onOk, onFail)
  }, [password])

  const handleReveal = useCallback(() => {
    onReveal()
    // Burn the one-time password server-side once the user scratches it open.
    fetcher.submit({ intent: "reveal" }, { method: "post" })
  }, [fetcher, onReveal])

  return (
    <Stack gap="xs">
      <InputGroup.Root>
        <ScratchCard
          width={320}
          height={48}
          revealThreshold={0.8}
          initialRevealed={revealed}
          onReveal={handleReveal}
          label={t("common.scratchToReveal")}
        >
          <Input defaultValue={password} />
        </ScratchCard>
        <InputGroup.Addon disabled={!revealed} minWidth={72} onClick={copyPassword}>
          {copied ? t("invite.password.copied") : t("invite.password.copy")}
        </InputGroup.Addon>
      </InputGroup.Root>
      {copyFailed && (
        <Text variant="bodySm" color="muted">
          {t("invite.password.copyFailed")}
        </Text>
      )}
    </Stack>
  )
}

export default function CertRevealPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const params = useParams()
  const downloadHref = `/cert/${params.revealToken}/download`

  if (!loaderData.valid) {
    const key =
      loaderData.error === "invalid"
        ? "certReveal.error.invalid"
        : loaderData.error === "expired"
          ? "certReveal.error.expired"
          : loaderData.error === "consumed"
            ? "certReveal.error.consumed"
            : "certReveal.error.unknown"
    const tone = loaderData.error === "consumed" ? "info" : "error"
    const icon = loaderData.error === "consumed" ? "check-done" : "x-circle"
    return <ErrorCard icon={icon} tone={tone} title={t("certReveal.error.title")} message={t(key)} />
  }

  if (loaderData.revealed) {
    return (
      <CenteredCardPage>
        <Stack gap="lg">
          <Heading level={1}>{t("certReveal.revealed.title")}</Heading>
          <Text as="p" color="muted">
            <Trans
              i18nKey="certReveal.revealed.note"
              values={{ email: loaderData.email }}
              components={{ strong: <strong /> }}
            />
          </Text>
          <LinkButton href={downloadHref} variant="primary" fullWidth>
            {t("certReveal.download")}
          </LinkButton>
        </Stack>
      </CenteredCardPage>
    )
  }

  return (
    <CenteredCardPage>
      <Stack gap="lg">
        <Stack gap="sm">
          <Heading level={1}>{t("certReveal.title")}</Heading>
          <Text as="p" color="muted">
            <Trans
              i18nKey="certReveal.subtitle"
              values={{ email: loaderData.email }}
              components={{ strong: <strong /> }}
            />
          </Text>
        </Stack>
        <PasswordCard password={loaderData.password} />
        <Text as="p" variant="bodySm" color="muted">
          {t("invite.password.oneTime")}
        </Text>
        <LinkButton href={downloadHref} variant="primary" fullWidth>
          {t("certReveal.download")}
        </LinkButton>
      </Stack>
    </CenteredCardPage>
  )
}
