import { useState } from "react"
import { Link, useNavigate } from "react-router"
import { useTranslation } from "react-i18next"
import { Button, Dialog, Inline, Menu, Stack, Text } from "@duro-app/ui"
import { colors } from "@duro-app/tokens/tokens/colors.css"
import { spacing } from "@duro-app/tokens/tokens/spacing.css"
import { typeScale } from "@duro-app/tokens/tokens/typography.css"
import { css, html } from "react-strict-dom"
import { RequestAccessDialog } from "~/components/RequestAccessDialog/RequestAccessDialog"

const styles = css.create({
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    // Wrap instead of letting the account menu get pushed off-screen on very
    // narrow viewports, and never let the row itself force horizontal overflow.
    flexWrap: "wrap",
    gap: spacing.sm,
    maxWidth: "100%",
    minWidth: 0,
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
  const [requestOpen, setRequestOpen] = useState(false)

  // The "Request access" entry is intentionally always visible — predictable
  // nav beats appearing/disappearing menu items, and the dialog itself can
  // teach the user when there's nothing to request. The dialog fetches its
  // own catalog from /api/catalog on open, so the Header pays no DB cost
  // until the user actually clicks.

  return (
    <html.div style={styles.row}>
      <Link to="/" style={{ textDecoration: "none" }}>
        <html.span style={styles.logo}>{t("common.appTitle")}</html.span>
      </Link>
      {showMenu && (
        <Menu.Root>
          <Menu.Trigger>{t("header.welcome", { user })} &#9662;</Menu.Trigger>
          <Menu.Popup align="end">
            <Menu.Item onClick={() => setRequestOpen(true)}>{t("header.requestAccess")}</Menu.Item>
            <Menu.LinkItem href="/catalog">{t("header.browseApps")}</Menu.LinkItem>
            <Menu.LinkItem href="/requests">{t("header.myRequests")}</Menu.LinkItem>
            {isAdmin && <Menu.LinkItem href="/admin">{t("common.admin")}</Menu.LinkItem>}
            <Menu.LinkItem href="/settings">{t("common.settings")}</Menu.LinkItem>
            <Menu.Item onClick={() => setLogoutOpen(true)}>{t("common.logout")}</Menu.Item>
          </Menu.Popup>
        </Menu.Root>
      )}

      <RequestAccessDialog open={requestOpen} onOpenChange={setRequestOpen} />

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
