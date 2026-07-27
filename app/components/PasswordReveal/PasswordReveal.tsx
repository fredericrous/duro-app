import { useCallback } from "react"
import { useTranslation } from "react-i18next"
import { useScratchReveal } from "~/hooks/useScratchReveal"
import type { SettingsResult } from "~/lib/mutations/settings"
import { useAction } from "~/hooks/useAction"
import { useCopyFeedback } from "~/hooks/useCopyFeedback"
import { ScratchCard } from "~/components/ScratchCard/ScratchCard"
import { Alert, Heading, Input, InputGroup, Stack, Text } from "@duro-app/ui"

export function PasswordReveal({ p12Password }: { p12Password: string }) {
  const { t } = useTranslation()
  const consumeAction = useAction<SettingsResult>("/settings")
  const { revealed, onReveal } = useScratchReveal("scratch:/settings")
  const { copied, copy } = useCopyFeedback()

  const consumeSubmit = consumeAction.submit
  const handleReveal = useCallback(() => {
    onReveal()
    // Consume the password in Vault
    void consumeSubmit({ intent: "consumePassword" })
  }, [consumeSubmit, onReveal])

  return (
    <Stack>
      <Alert variant="info">
        <Heading level={3} variant="headingSm">
          {t("settings.cert.passwordTitle")}
        </Heading>
        <Text as="p">{t("settings.cert.passwordWarning")}</Text>
        <InputGroup.Root>
          <ScratchCard width={320} height={48} onReveal={handleReveal} label={t("common.scratchToReveal")}>
            <Input defaultValue={p12Password} />
          </ScratchCard>
          <InputGroup.Addon disabled={!revealed} onClick={() => copy(p12Password)}>
            {copied ? t("settings.cert.copied") : t("settings.cert.copy")}
          </InputGroup.Addon>
        </InputGroup.Root>
      </Alert>
    </Stack>
  )
}
