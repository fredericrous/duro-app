import { useTranslation } from "react-i18next"
import { StatusIcon } from "~/components/StatusIcon/StatusIcon"
import styles from "./NoAccess.module.css"

interface NoAccessProps {
  user: string | null
}

export function NoAccess({ user }: NoAccessProps) {
  const { t } = useTranslation()

  return (
    <div className={styles.container}>
      <StatusIcon name="forbidden" size={64} className={styles.icon} />
      <h1 className={styles.title}>{t("noAccess.title")}</h1>
      <p className={styles.message}>{user ? t("noAccess.messageUser", { user }) : t("noAccess.messageAnon")}</p>
      <p className={styles.hint}>{t("noAccess.hint")}</p>
    </div>
  )
}
