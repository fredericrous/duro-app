import { useState } from "react"
import { Link, useNavigate } from "react-router"
import { useTranslation } from "react-i18next"
import { Button, Dialog, Inline, Menu, Stack, Text } from "@duro-app/ui"
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
  const navigate = useNavigate()
  const [logoutOpen, setLogoutOpen] = useState(false)

  return (
    <html.div style={styles.row}>
      <Link to="/" style={{ textDecoration: "none" }}>
        <html.span style={styles.logo}>{t("common.appTitle")}</html.span>
      </Link>
      {showMenu && (
        <Menu.Root>
          <Menu.Trigger>{t("header.welcome", { user })} &#9662;</Menu.Trigger>
          <Menu.Popup align="end">
            {isAdmin && <Menu.LinkItem href="/admin">{t("common.admin")}</Menu.LinkItem>}
            <Menu.LinkItem href="/settings">{t("common.settings")}</Menu.LinkItem>
            <Menu.Item onClick={() => setLogoutOpen(true)}>{t("common.logout")}</Menu.Item>
          </Menu.Popup>
        </Menu.Root>
      )}

      <Dialog.Root open={logoutOpen} onOpenChange={setLogoutOpen}>
        <Dialog.Portal size="sm">
          <Dialog.Header>
            <Dialog.Title>{t("auth.logout.confirmTitle")}</Dialog.Title>
            <Dialog.Close aria-label={t("admin.detailPanel.close")} />
          </Dialog.Header>
          <Dialog.Body>
            <Stack gap="md">
              <Text as="p">{t("auth.logout.confirmBody")}</Text>
              <Text as="p" color="muted" variant="bodySm">
                {t("auth.logout.confirmHint")}
              </Text>
            </Stack>
          </Dialog.Body>
          <Dialog.Footer>
            <Inline gap="sm">
              <Button variant="secondary" onClick={() => setLogoutOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setLogoutOpen(false)
                  navigate("/auth/logout")
                }}
              >
                {t("auth.logout.confirmButton")}
              </Button>
            </Inline>
          </Dialog.Footer>
        </Dialog.Portal>
      </Dialog.Root>
    </html.div>
  )
}
