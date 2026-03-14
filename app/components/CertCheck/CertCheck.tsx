import { useLocalSearchParams } from "expo-router"
import { useTranslation } from "react-i18next"
import { Alert, Button } from "@duro-app/ui"
import { css, html } from "react-strict-dom"

const styles = css.create({
  certCheck: {
    marginBottom: 24,
  },
  certWarningContent: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  certHint: {
    color: "#999",
  },
  certTextHidden: {
    visibility: "hidden",
  },
  btnRetry: {
    padding: "8px 16px",
    fontSize: "0.8rem",
    backgroundColor: "rgba(251, 191, 36, 0.15)",
    color: "#fbbf24",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "rgba(251, 191, 36, 0.3)",
    borderRadius: 4,
    cursor: "pointer",
    width: "100%",
  },
  continueLink: {
    display: "block",
    width: "100%",
    marginTop: 8,
    padding: "8px 16px",
    borderRadius: 4,
    fontSize: "0.875rem",
    fontWeight: "500",
    textAlign: "center",
    textDecoration: "none",
    backgroundColor: "#6366f1",
    color: "#fff",
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
    <>
      <html.div style={styles.certCheck}>
        <Alert variant={installed ? "success" : "warning"}>
          {installed ? (
            <html.p>{t("invite.cert.detected")}</html.p>
          ) : (
            <html.div style={styles.certWarningContent}>
              <html.p style={status === "checking" ? styles.certTextHidden : undefined}>
                {t("invite.cert.notInstalled")}
              </html.p>
              <html.p style={status === "checking" ? styles.certTextHidden : styles.certHint}>{t("invite.cert.hint")}</html.p>
              <html.button
                type="button"
                onClick={onRecheck}
                style={styles.btnRetry}
                disabled={status === "checking"}
                tabIndex={status === "checking" ? -1 : undefined}
              >
                {status === "checking" ? t("invite.cert.checking") : t("invite.cert.retry")}
              </html.button>
            </html.div>
          )}
        </Alert>
      </html.div>
      {installed ? (
        <html.a href={`/invite/${token}/create-account`} style={styles.continueLink}>
          {t("invite.cert.continue")}
        </html.a>
      ) : (
        <Button fullWidth disabled>
          {t("invite.cert.continue")}
        </Button>
      )}
    </>
  )
}
