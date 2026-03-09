import { Link } from "react-router"
import { useTranslation } from "react-i18next"
import { Menu } from "@duro-app/ui"
import styles from "./Header.module.css"

interface HeaderProps {
  user: string
  isAdmin: boolean
}

export function Header({ user, isAdmin }: HeaderProps) {
  const { t } = useTranslation()

  return (
    <header className={styles.header}>
      <Link to="/" className={styles.title}>
        {t("common.appTitle")}
      </Link>
      <Menu.Root>
        <Menu.Trigger>{t("header.welcome", { user })} &#9662;</Menu.Trigger>
        <Menu.Popup align="end">
          {isAdmin && <Menu.LinkItem href="/admin">{t("common.admin")}</Menu.LinkItem>}
          <Menu.LinkItem href="/settings">{t("common.settings")}</Menu.LinkItem>
          <Menu.LinkItem href="/auth/logout">{t("common.logout")}</Menu.LinkItem>
        </Menu.Popup>
      </Menu.Root>
    </header>
  )
}
