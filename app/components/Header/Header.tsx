import { useState } from "react"
import { Link, useNavigate, useRouteLoaderData } from "react-router"
import { useTranslation } from "react-i18next"
import { Badge, Button, Dialog, Inline, LinkButton, Menu, Stack, Text } from "@duro-app/ui"
import { colors } from "@duro-app/tokens/tokens/colors.css"
import { spacing } from "@duro-app/tokens/tokens/spacing.css"
import { typeScale } from "@duro-app/tokens/tokens/typography.css"
import { css, html } from "react-strict-dom"

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
  // The primary verbs (Request access, My requests) live here as visible
  // controls rather than buried in the account dropdown — hidden actions get
  // forgotten. The cluster wraps on narrow viewports so nothing overflows.
  actions: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: spacing.sm,
    minWidth: 0,
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

  // Badge "My requests" with the count of items awaiting the user (their own
  // in-flight requests + open invitations), loaded once by the dashboard
  // layout. Reading it here keeps every caller from having to thread the count
  // through as a prop; it falls back to 0 outside that layout (e.g. tests).
  const dashboard = useRouteLoaderData("routes/dashboard") as { openRequestItems?: number } | undefined
  const openItems = dashboard?.openRequestItems ?? 0

  // "Request access" is the primary verb, so it's a persistent primary control
  // that takes the user to the catalog — where they browse and request. The
  // account menu keeps only identity actions, where people expect to find them.

  return (
    <html.div style={styles.row}>
      <Link to="/" style={{ textDecoration: "none" }}>
        <html.span style={styles.logo}>{t("common.appTitle")}</html.span>
      </Link>
      {showMenu && (
        <html.div style={styles.actions}>
          <LinkButton href="/catalog" variant="primary">
            {t("header.requestAccess")}
          </LinkButton>
          <LinkButton href="/requests" variant="secondary">
            {t("header.myRequests")}
            {openItems > 0 && (
              <Badge variant="info" size="sm">
                {openItems}
              </Badge>
            )}
          </LinkButton>
          <Menu.Root>
            <Menu.Trigger>{t("header.welcome", { user })} &#9662;</Menu.Trigger>
            <Menu.Popup align="end">
              {isAdmin && <Menu.LinkItem href="/admin">{t("common.admin")}</Menu.LinkItem>}
              <Menu.LinkItem href="/settings">{t("common.settings")}</Menu.LinkItem>
              <Menu.Item onClick={() => setLogoutOpen(true)}>{t("common.logout")}</Menu.Item>
            </Menu.Popup>
          </Menu.Root>
        </html.div>
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
