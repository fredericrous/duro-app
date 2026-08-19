import { useCallback } from "react"
import { useFetcher } from "react-router"
import { useTranslation } from "react-i18next"
import { useScratchReveal } from "~/hooks/useScratchReveal"
import { useCopyFeedback } from "~/hooks/useCopyFeedback"
import { ScratchCard } from "~/components/ScratchCard/ScratchCard"
import { Card, Heading, Icon, Input, InputGroup, Stack, Text } from "@duro-app/ui"
import { css, html } from "react-strict-dom"

const styles = css.create({
  oneTimeHidden: {
    visibility: "hidden",
  },
  headerRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
})

export function InvitePasswordReveal({ hasPassword }: { hasPassword: boolean }) {
  const { t } = useTranslation()
  // The scratch gesture posts the reveal intent and the response carries the
  // password — it never rides the loader (GET), so it is absent from the SSR
  // HTML, the hydration payload, and anything that prefetches the link.
  const fetcher = useFetcher<{ revealed?: boolean; p12Password?: string | null }>()
  const p12Password = fetcher.data?.p12Password ?? null
  const { revealed, onReveal } = useScratchReveal(
    `scratch:${typeof window !== "undefined" ? window.location.pathname : ""}`,
  )
  const { copied, copy } = useCopyFeedback()

  const handleReveal = useCallback(() => {
    onReveal()
    fetcher.submit({ intent: "reveal" }, { method: "post" })
  }, [fetcher, onReveal])

  if (!hasPassword) {
    return (
      <Card>
        <Stack gap="sm">
          <html.div style={styles.headerRow}>
            <Icon name="lock-filled" size="md" />
            <Heading level={2} variant="headingSm">
              {t("invite.password.title")}
            </Heading>
          </html.div>
          <Text as="p" color="muted">
            {t("invite.password.consumed")}
          </Text>
        </Stack>
      </Card>
    )
  }

  return (
    <Card>
      <Stack gap="sm">
        <html.div style={styles.headerRow}>
          <Icon name="lock-filled" size="md" />
          <Heading level={2} variant="headingSm">
            {t("invite.password.title")}
          </Heading>
        </html.div>
        <Text as="p" color="muted">
          {t("invite.password.warning")}
        </Text>
        <InputGroup.Root>
          <ScratchCard
            width={320}
            height={48}
            revealThreshold={0.8}
            initialRevealed={revealed}
            onReveal={handleReveal}
            label={t("common.scratchToReveal")}
          >
            <Input value={p12Password ?? ""} readOnly />
          </ScratchCard>
          <InputGroup.Addon
            disabled={!revealed || p12Password === null}
            minWidth={72}
            onClick={() => p12Password !== null && copy(p12Password)}
          >
            {copied ? t("invite.password.copied") : t("invite.password.copy")}
          </InputGroup.Addon>
        </InputGroup.Root>
        <html.div style={!revealed ? styles.oneTimeHidden : undefined}>
          <Text as="p" variant="bodySm">
            {t("invite.password.oneTime")}
          </Text>
        </html.div>
      </Stack>
    </Card>
  )
}
