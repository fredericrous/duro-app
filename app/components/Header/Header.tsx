import { Link } from "react-router"
import { useTranslation } from "react-i18next"
import { Menu } from "@base-ui/react/menu"
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
      <Menu.Root modal={false}>
        <Menu.Trigger className={styles.trigger}>
          {t("header.welcome", { user })} <span className={styles.caret}>&#9662;</span>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" alignment="end" sideOffset={6}>
            <Menu.Popup className={styles.dropdown}>
              {isAdmin && (
                <Menu.LinkItem href="/admin" className={styles.dropdownItem}>
                  {t("common.admin")}
                </Menu.LinkItem>
              )}
              <Menu.LinkItem href="/settings" className={styles.dropdownItem}>
                {t("common.settings")}
              </Menu.LinkItem>
              <Menu.LinkItem href="/auth/logout" className={styles.dropdownItem}>
                {t("common.logout")}
              </Menu.LinkItem>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </header>
  )
}
