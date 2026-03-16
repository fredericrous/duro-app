import { useLocalSearchParams } from "expo-router"
import { useTranslation } from "react-i18next"
import { Alert, Button, LinkButton, Stack, Text } from "@duro-app/ui"
import { colors } from "@duro-app/tokens/tokens/colors.css"
import { radii, spacing } from "@duro-app/tokens/tokens/spacing.css"
import { typeScale, typography } from "@duro-app/tokens/tokens/typography.css"
import { css, html } from "react-strict-dom"

const styles = css.create({
  certTextHidden: {
    visibility: "hidden",
  },
  btnRetry: {
    padding: spacing.sm,
    paddingLeft: spacing.ms,
    paddingRight: spacing.ms,
    fontSize: typeScale.fontSize3,
    fontWeight: typography.fontWeightMedium,
    backgroundColor: {
      default: colors.warningBg,
      ":hover": "rgba(251, 191, 36, 0.25)",
    },
    color: colors.warning,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.warningBorder,
    borderRadius: radii.sm,
    cursor: "pointer",
    width: "100%",
  },
  btnRetryDisabled: {
    opacity: 0.5,
    cursor: "default",
  },
})

export function CertCheck({
  status,
  onRecheck,
}: {
  status: "checking" | "installed" | "not-installed"
  onRecheck: () => void
}) {
  const { t } = useTranslation()
  const { token } = useLocalSearchParams<{ token: string }>()
  const installed = status === "installed"

  return (
    <Stack gap="md">
      {installed ? (
        <Alert variant="success">
          <Text as="p">{t("invite.cert.detected")}</Text>
        </Alert>
      ) : (
        <Stack gap="sm">
          <Alert variant="warning">
            <html.div style={status === "checking" ? styles.certTextHidden : undefined}>
              <Text as="p">{t("invite.cert.notInstalled")}</Text>
            </html.div>
          </Alert>
          <html.div style={status === "checking" ? styles.certTextHidden : undefined}>
            <Text as="p" color="muted" variant="bodySm">
              {t("invite.cert.hint")}
            </Text>
          </html.div>
          <html.button
            onClick={onRecheck}
            disabled={status === "checking"}
            style={[styles.btnRetry, status === "checking" && styles.btnRetryDisabled]}
          >
            {status === "checking" ? t("invite.cert.checking") : t("invite.cert.retry")}
          </html.button>
        </Stack>
      )}
      {installed ? (
        <LinkButton href={`/invite/${token}/create-account`} variant="primary" fullWidth>
          {t("invite.cert.continue")}
        </LinkButton>
      ) : (
        <Button fullWidth disabled>
          {t("invite.cert.continue")}
        </Button>
      )}
    </Stack>
  )
}
