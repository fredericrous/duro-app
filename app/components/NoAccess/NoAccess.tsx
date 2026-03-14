import { useTranslation } from "react-i18next"
import { Heading, Stack, StatusIcon, Text } from "@duro-app/ui"
import { css, html } from "react-strict-dom"

const styles = css.create({
  container: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    padding: 32,
  },
  icon: {
    marginBottom: 24,
  },
})

interface NoAccessProps {
  user: string | null
}

export function NoAccess({ user }: NoAccessProps) {
  const { t } = useTranslation()

  return (
    <html.div style={styles.container}>
      <html.div style={styles.icon}>
        <StatusIcon name="forbidden" size={64} variant="error" />
      </html.div>
      <Stack gap="sm" align="center">
        <Heading level={1}>{t("noAccess.title")}</Heading>
        <Text variant="bodyLg" color="muted" as="p">
          {user ? t("noAccess.messageUser", { user }) : t("noAccess.messageAnon")}
        </Text>
        <Text variant="bodySm" color="muted" as="p">
          {t("noAccess.hint")}
        </Text>
      </Stack>
    </html.div>
  )
}
