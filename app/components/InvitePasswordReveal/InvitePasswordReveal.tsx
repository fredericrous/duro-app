import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useScratchReveal } from "~/hooks/useScratchReveal"
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

export function InvitePasswordReveal({ p12Password }: { p12Password: string | null }) {
  const { t } = useTranslation()
  const { revealed, onReveal } = useScratchReveal(
    `scratch:${typeof window !== "undefined" ? window.location.pathname : ""}`,
  )
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null)

  if (!p12Password) {
    return (
      <Card>
        <Stack gap="sm">
          <html.div style={styles.headerRow}>
            <Icon name="lock-filled" size={20} />
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
          <Icon name="lock-filled" size={20} />
          <Heading level={2} variant="headingSm">
            {t("invite.password.title")}
          </Heading>
        </html.div>
        <Text as="p" color="muted">
          {t("invite.password.warning")}
        </Text>
        <InputGroup.Root>
          <ScratchCard width={320} height={48} onReveal={onReveal}>
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
        <html.div style={!revealed ? styles.oneTimeHidden : undefined}>
          <Text as="p" variant="bodySm">
            {t("invite.password.oneTime")}
          </Text>
        </html.div>
      </Stack>
    </Card>
  )
}
