import { useTranslation } from "react-i18next"
import { StatusIcon } from "@duro-app/ui"
import styles from "./NoAccess.module.css"

interface NoAccessProps {
  user: string | null
}

export function NoAccess({ user }: NoAccessProps) {
  const { t } = useTranslation()

  return (
    <div className={styles.container}>
      <div className={styles.icon}>
        <StatusIcon name="forbidden" size={64} />
      </div>
      <h1 className={styles.title}>{t("noAccess.title")}</h1>
      <p className={styles.message}>{user ? t("noAccess.messageUser", { user }) : t("noAccess.messageAnon")}</p>
      <p className={styles.hint}>{t("noAccess.hint")}</p>
    </div>
  )
}
