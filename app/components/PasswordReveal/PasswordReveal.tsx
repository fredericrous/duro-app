import { useCallback, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useScratchReveal } from "~/hooks/useScratchReveal"
import type { SettingsResult } from "~/lib/mutations/settings"
import { useAction } from "~/hooks/useAction"
import { ScratchCard } from "~/components/ScratchCard/ScratchCard"
import { Alert, Heading, Input, InputGroup } from "@duro-app/ui"
import { html } from "react-strict-dom"

export function PasswordReveal({ p12Password }: { p12Password: string }) {
  const { t } = useTranslation()
  const consumeAction = useAction<SettingsResult>("/settings")
  const { revealed, onReveal } = useScratchReveal("scratch:/settings")
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null)

  const handleReveal = useCallback(() => {
    onReveal()
    // Consume the password in Vault
    consumeAction.submit({ intent: "consumePassword" })
  }, [consumeAction, onReveal])

  return (
    <html.div>
      <Alert variant="info">
        <Heading level={3} variant="headingSm">
          {t("settings.cert.passwordTitle")}
        </Heading>
        <html.p>{t("settings.cert.passwordWarning")}</html.p>
        <InputGroup.Root>
          <ScratchCard width={320} height={48} onReveal={handleReveal}>
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
            {copied ? t("settings.cert.copied") : t("settings.cert.copy")}
          </InputGroup.Addon>
        </InputGroup.Root>
      </Alert>
    </html.div>
  )
}
