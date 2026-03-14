import { Link } from "expo-router"
import { useTranslation } from "react-i18next"
import { Menu } from "@duro-app/ui"
import { css, html } from "react-strict-dom"

const styles = css.create({
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    maxWidth: 1200,
    margin: "0 auto",
    padding: "24px 24px 0",
  },
  title: {
    fontSize: "1.75rem",
    fontWeight: 700,
    textDecoration: "none",
    color: "var(--color-text)",
  },
})

interface HeaderProps {
  user: string
  isAdmin: boolean
  showMenu?: boolean
}

export function Header({ user, isAdmin, showMenu = true }: HeaderProps) {
  const { t } = useTranslation()

  return (
    <html.header style={styles.header}>
      <Link href="/" style={styles.title as any}>
        {t("common.appTitle")}
      </Link>
      {showMenu && (
        <Menu.Root>
          <Menu.Trigger>{t("header.welcome", { user })} &#9662;</Menu.Trigger>
          <Menu.Popup align="end">
            {isAdmin && <Menu.LinkItem href="/admin">{t("common.admin")}</Menu.LinkItem>}
            <Menu.LinkItem href="/settings">{t("common.settings")}</Menu.LinkItem>
            <Menu.LinkItem href="/auth/logout">{t("common.logout")}</Menu.LinkItem>
          </Menu.Popup>
        </Menu.Root>
      )}
    </html.header>
  )
}
