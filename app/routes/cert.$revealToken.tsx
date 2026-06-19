import { useCallback, useRef, useState } from "react"
import { Trans, useTranslation } from "react-i18next"
import { useFetcher } from "react-router"
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
import { Heading, Input, InputGroup, Stack, Text } from "@duro-app/ui"

type CertRevealError = "invalid" | "expired" | "consumed" | "unknown"

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.appName ? `Certificate password — ${data.appName}` : "Certificate password" }]
}

/**
 * Resolve the reveal token to its current state. Shared by loader and action so
 * both apply the same invalid/expired/consumed gating. Reads (never consumes)
 * the P12 password — consumption happens only on the explicit reveal POST, so
 * a link-scanner's prefetch GET cannot burn the one-time secret.
 */
const resolve = (revealToken: string) =>
  Effect.gen(function* () {
    const revealRepo = yield* CertRevealRepo
    const cert = yield* CertManager
    const row = yield* revealRepo.findByTokenHash(hashToken(revealToken))
    if (!row) return { state: "invalid" as const }
    if (row.revealedAt) return { state: "consumed" as const, row }
    if (new Date(row.expiresAt) < new Date()) return { state: "expired" as const, row }
    const p12Password = yield* cert.getP12Password(row.renewalId)
    if (!p12Password) return { state: "consumed" as const, row }
    return { state: "ok" as const, row, p12Password }
  })

export async function loader({ params }: Route.LoaderArgs) {
  const revealToken = params.revealToken
  if (!revealToken) {
    return { valid: false as const, error: "invalid" as CertRevealError, appName: config.appName }
  }

  try {
    const result = await runEffect(resolve(revealToken))
    if (result.state === "ok") {
      return { valid: true as const, email: result.row.email, p12Password: result.p12Password, appName: config.appName }
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
        // Mark the link used and burn the Vault password secret — single use.
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

function RevealCard({ p12Password }: { p12Password: string }) {
  const { t } = useTranslation()
  const fetcher = useFetcher()
  const { revealed, onReveal } = useScratchReveal(
    `scratch:${typeof window !== "undefined" ? window.location.pathname : ""}`,
  )
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null)

  const handleReveal = useCallback(() => {
    onReveal()
    // Burn the one-time secret server-side once the user scratches it open.
    fetcher.submit({ intent: "reveal" }, { method: "post" })
  }, [fetcher, onReveal])

  return (
    <InputGroup.Root>
      <ScratchCard width={320} height={48} onReveal={handleReveal}>
        <Input defaultValue={p12Password} />
      </ScratchCard>
      <InputGroup.Addon
        disabled={!revealed}
        minWidth={72}
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
  )
}

export default function CertRevealPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()

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
        <RevealCard p12Password={loaderData.p12Password} />
        <Text as="p" variant="bodySm" color="muted">
          {t("invite.password.oneTime")}
        </Text>
      </Stack>
    </CenteredCardPage>
  )
}
