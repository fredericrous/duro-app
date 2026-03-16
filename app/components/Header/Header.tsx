import { Link } from "expo-router"
import { useTranslation } from "react-i18next"
import { Menu } from "@duro-app/ui"
import { colors } from "@duro-app/tokens/tokens/colors.css"
import { typeScale } from "@duro-app/tokens/tokens/typography.css"
import { css, html } from "react-strict-dom"

const styles = css.create({
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  logo: {
    fontSize: typeScale.fontSize9,
    fontWeight: 700,
    letterSpacing: typeScale.letterSpacingTight,
    textDecoration: "none",
    color: colors.text,
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
    <html.div style={styles.row}>
      <Link href="/" style={{ textDecoration: "none" }}>
        <html.span style={styles.logo}>{t("common.appTitle")}</html.span>
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
    </html.div>
  )
}
