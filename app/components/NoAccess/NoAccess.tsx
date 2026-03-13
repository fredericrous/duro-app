import { useTranslation } from "react-i18next"
import { Heading, StatusIcon, Text } from "@duro-app/ui"
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
      <Heading level={1}>{t("noAccess.title")}</Heading>
      <Text variant="bodyLg" color="muted" as="p">{user ? t("noAccess.messageUser", { user }) : t("noAccess.messageAnon")}</Text>
      <Text variant="bodySm" color="muted" as="p">{t("noAccess.hint")}</Text>
    </div>
  )
}
