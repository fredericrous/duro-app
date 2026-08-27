import { useParams } from "react-router"
import { Trans, useTranslation } from "react-i18next"
import { Alert, Button, LinkButton, Stack, Text } from "@duro-app/ui"
import { colors } from "@duro-app/tokens/tokens/colors.css"
import { radii, spacing } from "@duro-app/tokens/tokens/spacing.css"
import { typeScale, typography } from "@duro-app/tokens/tokens/typography.css"
import { css, html } from "react-strict-dom"
import type { CertStore } from "~/lib/cert-store"
import { UnsupportedBrowser } from "~/components/UnsupportedBrowser/UnsupportedBrowser"

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
      ":hover": colors.warningBorder,
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
  store = "system",
  onIos = false,
  inviteUrl,
  chromeUrl,
}: {
  status: "checking" | "installed" | "not-installed"
  onRecheck: () => void
  /** Where this browser looks for client certificates — see ~/lib/cert-store. */
  store?: CertStore
  /** Drives which browser the visitor is sent to when `store` is "none". */
  onIos?: boolean
  /** Canonical invite URL, offered for copying into a browser that can finish. */
  inviteUrl?: string
  /** Android intent link that reopens this invite in Chrome, when applicable. */
  chromeUrl?: string | null
}) {
  const { t } = useTranslation()
  const { token } = useParams()
  const installed = status === "installed"

  return (
    <Stack gap="md">
      {installed ? (
        <Alert variant="success">
          <Text as="p">{t("invite.cert.detected")}</Text>
        </Alert>
      ) : store === "none" ? (
        // A browser that can never present a certificate must not be offered a
        // "check again" button: the probe it would re-run cannot succeed, and
        // pairing the retry with the explanation just restarts the loop this
        // state exists to end. The probe still runs once on mount, so a
        // misread User-Agent self-corrects into the success branch above.
        <UnsupportedBrowser onIos={onIos} inviteUrl={inviteUrl} chromeUrl={chromeUrl} />
      ) : (
        <Stack gap="sm">
          <Alert variant="warning">
            <html.div style={status === "checking" ? styles.certTextHidden : undefined}>
              <Text as="p">{t("invite.cert.notInstalled")}</Text>
            </html.div>
          </Alert>
          <html.div style={status === "checking" ? styles.certTextHidden : undefined}>
            <Text as="p" color="muted" variant="bodySm">
              {store === "own" ? (
                // Desktop Firefox: the certificate is installed, just not
                // anywhere Firefox looks. "Reopen your browser" would be
                // wrong advice here — it needs a second, in-Firefox import.
                <Trans i18nKey="certInstall.firefox" components={{ strong: <html.strong /> }} />
              ) : (
                t("invite.cert.hint")
              )}
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
      ) : store === "none" ? null : (
        <Button fullWidth disabled>
          {t("invite.cert.continue")}
        </Button>
      )}
    </Stack>
  )
}
