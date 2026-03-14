import { useParams } from "react-router"
import { useTranslation } from "react-i18next"
import { Alert, Button } from "@duro-app/ui"
import styles from "~/routes/invite.module.css"

export function CertCheck({
  status,
  onRecheck,
}: {
  status: "checking" | "installed" | "not-installed"
  onRecheck: () => void
}) {
  const { t } = useTranslation()
  const { token } = useParams()
  const installed = status === "installed"

  return (
    <>
      <div className={styles.certCheck}>
        <Alert variant={installed ? "success" : "warning"}>
          {installed ? (
            <p>{t("invite.cert.detected")}</p>
          ) : (
            <div className={styles.certWarningContent}>
              <p className={status === "checking" ? styles.certTextHidden : undefined}>
                {t("invite.cert.notInstalled")}
              </p>
              <p className={status === "checking" ? styles.certTextHidden : styles.certHint}>{t("invite.cert.hint")}</p>
              <button
                type="button"
                onClick={onRecheck}
                className={styles.btnRetry}
                disabled={status === "checking"}
                tabIndex={status === "checking" ? -1 : undefined}
              >
                {status === "checking" ? t("invite.cert.checking") : t("invite.cert.retry")}
              </button>
            </div>
          )}
        </Alert>
      </div>
      {installed ? (
        <a href={`/invite/${token}/create-account`} className={styles.continueLink}>
          {t("invite.cert.continue")}
        </a>
      ) : (
        <Button fullWidth disabled>
          {t("invite.cert.continue")}
        </Button>
      )}
    </>
  )
}
