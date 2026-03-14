import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useScratchReveal } from "~/hooks/useScratchReveal"
import { ScratchCard } from "~/components/ScratchCard/ScratchCard"
import { Alert, Heading, Input, InputGroup } from "@duro-app/ui"
import { css, html } from "react-strict-dom"

const styles = css.create({
  section: {
    marginBottom: 24,
  },
  oneTimeHidden: {
    visibility: "hidden",
  },
})

export function InvitePasswordReveal({ p12Password }: { p12Password: string | null }) {
  const { t } = useTranslation()
  const { revealed, onReveal } = useScratchReveal(`scratch:${typeof window !== "undefined" ? window.location.pathname : ""}`)
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null)

  if (!p12Password) {
    return (
      <html.div style={styles.section}>
        <Alert variant="info">
          <Heading level={2} variant="headingSm">
            {t("invite.password.title")}
          </Heading>
          <html.p>{t("invite.password.consumed")}</html.p>
        </Alert>
      </html.div>
    )
  }

  return (
    <html.div style={styles.section}>
      <Alert variant="info">
        <Heading level={2} variant="headingSm">
          {t("invite.password.title")}
        </Heading>
        <html.p>{t("invite.password.warning")}</html.p>
        <InputGroup.Root>
          <ScratchCard width={320} height={48} onReveal={onReveal}>
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
        <html.div style={!revealed ? styles.oneTimeHidden : undefined}>
          <html.p>{t("invite.password.oneTime")}</html.p>
        </html.div>
      </Alert>
    </html.div>
  )
}
