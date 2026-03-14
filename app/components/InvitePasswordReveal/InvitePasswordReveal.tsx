import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useScratchReveal } from "~/hooks/useScratchReveal"
import { ScratchCard } from "~/components/ScratchCard/ScratchCard"
import { Alert, Heading, Input, InputGroup } from "@duro-app/ui"
import styles from "~/routes/invite.module.css"

export function InvitePasswordReveal({ p12Password }: { p12Password: string | null }) {
  const { t } = useTranslation()
  const { revealed, onReveal } = useScratchReveal(`scratch:${typeof window !== "undefined" ? window.location.pathname : ""}`)
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null)

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
          <ScratchCard width={320} height={48} onReveal={onReveal} className={styles.scratchInline}>
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
