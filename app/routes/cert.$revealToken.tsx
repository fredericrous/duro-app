import { useCallback, useState } from "react"
import { html } from "react-strict-dom"
import { Trans, useTranslation } from "react-i18next"
import { useFetcher, useParams } from "react-router"
import type { Route } from "./+types/cert.$revealToken"
import { runEffect } from "~/lib/runtime.server"
import { consumeReveal, nameDeviceFromReveal, resolveReveal } from "~/lib/workflows/cert-reveal.server"
import { config, isOriginAllowed } from "~/lib/config.server"
import { Effect } from "effect"
import { CenteredCardPage } from "~/components/CenteredCardPage/CenteredCardPage"
import { ErrorCard } from "~/components/ErrorCard/ErrorCard"
import { useScratchReveal } from "~/hooks/useScratchReveal"
import { useCopyFeedback } from "~/hooks/useCopyFeedback"
import { ScratchCard } from "~/components/ScratchCard/ScratchCard"
import { Heading, Input, InputGroup, LinkButton, Stack, Text } from "@duro-app/ui"

type CertRevealError = "invalid" | "expired" | "consumed" | "unknown"

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.appName ? `Your certificate — ${data.appName}` : "Your certificate" }]
}

export async function loader({ params }: Route.LoaderArgs) {
  const revealToken = params.revealToken
  if (!revealToken) {
    return { valid: false as const, error: "invalid" as CertRevealError, appName: config.appName }
  }

  const result = await runEffect(
    resolveReveal(revealToken).pipe(
      Effect.catchAll((e) =>
        Effect.logError("[cert-reveal] loader error", { error: String(e) }).pipe(
          Effect.as({ state: "unknown" as const }),
        ),
      ),
    ),
  )
  if (result.state === "ok") {
    return {
      valid: true as const,
      revealed: false as const,
      email: result.row.email,
      password: result.password,
      canName: result.row.serialNumber !== null,
      appName: config.appName,
    }
  }
  if (result.state === "revealed") {
    return {
      valid: true as const,
      revealed: true as const,
      email: result.row.email,
      canName: result.row.serialNumber !== null,
      appName: config.appName,
    }
  }
  return { valid: false as const, error: result.state as CertRevealError, appName: config.appName }
}

export async function action({ request, params }: Route.ActionArgs) {
  const revealToken = params.revealToken
  if (!revealToken) return { revealed: false as const }
  if (!isOriginAllowed(request.headers.get("Origin"))) return { revealed: false as const }

  const formData = await request.formData()
  const intent = formData.get("intent")

  // Claim-time naming: the link is minted name-less; the device names itself
  // here. Token-authed like everything else on this page.
  if (intent === "name") {
    const label = String(formData.get("label") ?? "")
    const result = await runEffect(
      nameDeviceFromReveal(revealToken, label).pipe(
        Effect.catchAll((e) =>
          Effect.logError("[cert-reveal] name error", { error: String(e) }).pipe(
            Effect.as({ named: false as const, reason: "unknown" as const }),
          ),
        ),
      ),
    )
    return result.named ? { named: true as const, label: result.label } : { named: false as const }
  }

  if (intent !== "reveal") return { revealed: false as const }

  const consumed = await runEffect(
    consumeReveal(revealToken).pipe(
      Effect.catchAll((e) =>
        Effect.logError("[cert-reveal] action error", { error: String(e) }).pipe(Effect.as(false)),
      ),
    ),
  )
  return { revealed: consumed }
}

function PasswordCard({ password }: { password: string }) {
  const { t } = useTranslation()
  const fetcher = useFetcher()
  const { revealed, onReveal } = useScratchReveal(
    `scratch:${typeof window !== "undefined" ? window.location.pathname : ""}`,
  )
  const { copied, copyFailed, copy } = useCopyFeedback()

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
        <InputGroup.Addon disabled={!revealed} minWidth={72} onClick={() => copy(password)}>
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

/**
 * "Name this device" — the claim-time half of the QR flow. The link is minted
 * without a name so the QR and email journeys stay identical; whoever holds
 * the link (the device being set up) names it here. Saved via its own
 * token-authed intent; renames later live on /devices as before.
 */
function DeviceNameCard() {
  const { t } = useTranslation()
  const fetcher = useFetcher<{ named?: boolean; label?: string }>()
  const [value, setValue] = useState("")
  const saved = fetcher.data?.named === true
  const savedLabel = fetcher.data?.label
  const submitting = fetcher.state !== "idle"

  if (saved) {
    return (
      <Text as="p" variant="bodySm" color="success">
        {t("certReveal.name.saved", { label: savedLabel })}
      </Text>
    )
  }
  return (
    <fetcher.Form method="post">
      <html.input type="hidden" name="intent" value="name" />
      <Stack gap="xs">
        <Text as="p" variant="bodySm" color="muted">
          {t("certReveal.name.hint")}
        </Text>
        <InputGroup.Root>
          <Input
            name="label"
            value={value}
            placeholder={t("certReveal.name.placeholder")}
            onChange={(e) => setValue(e.target.value)}
            disabled={submitting}
          />
          <InputGroup.Addon
            disabled={submitting || value.trim() === ""}
            minWidth={72}
            onClick={() => {
              fetcher.submit({ intent: "name", label: value }, { method: "post" })
            }}
          >
            {submitting ? t("certReveal.name.saving") : t("certReveal.name.save")}
          </InputGroup.Addon>
        </InputGroup.Root>
      </Stack>
    </fetcher.Form>
  )
}

export default function CertRevealPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const params = useParams()
  const downloadHref = `/cert/${params.revealToken}/download`

  // Scratching burns the password server-side, so the revalidation that follows
  // the reveal POST returns `revealed: true` — within a round-trip of the
  // scratch, and long before anyone can hit Copy. Hold on to what this page
  // load was handed so the password and its Copy button survive that flip; a
  // fresh load has nothing captured and still gets the "already revealed" card.
  const [sessionPassword] = useState(() => (loaderData.valid && !loaderData.revealed ? loaderData.password : null))

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

  const password = sessionPassword ?? (loaderData.revealed ? null : loaderData.password)

  if (!password) {
    return (
      <CenteredCardPage>
        <Stack gap="lg">
          <Heading level={1}>{t("certReveal.revealed.title")}</Heading>
          <Text as="p" color="muted">
            <Trans
              i18nKey="certReveal.revealed.note"
              values={{ email: loaderData.email }}
              components={{ strong: <html.strong /> }}
            />
          </Text>
          {loaderData.canName && <DeviceNameCard />}
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
              components={{ strong: <html.strong /> }}
            />
          </Text>
        </Stack>
        <PasswordCard password={password} />
        <Text as="p" variant="bodySm" color="muted">
          {t("invite.password.oneTime")}
        </Text>
        {loaderData.canName && <DeviceNameCard />}
        <LinkButton href={downloadHref} variant="primary" fullWidth>
          {t("certReveal.download")}
        </LinkButton>
      </Stack>
    </CenteredCardPage>
  )
}
