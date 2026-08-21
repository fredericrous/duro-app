import { useTranslation } from "react-i18next"
import type { AppDefinition } from "~/lib/apps"
import { useLinkTarget } from "~/hooks/useLinkTarget"
import { Card, Stack, Text } from "@duro-app/ui"
import { Icon } from "../Icon"
import { css, html } from "react-strict-dom"
import { colors } from "@duro-app/tokens/tokens/colors.css"

const styles = css.create({
  link: {
    textDecoration: "none",
    color: "inherit",
  },
  icon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 48,
    height: 48,
    color: colors.accent,
  },
})

interface AppCardProps {
  app: AppDefinition
}

export function AppCard({ app }: AppCardProps) {
  const { t } = useTranslation()
  const linkProps = useLinkTarget()
  // An empty/placeholder URL signals "no launch target configured" — render a
  // non-interactive card with a hint instead of an anchor that goes to "#".
  const hasLaunchUrl = Boolean(app.url) && app.url !== "#"

  const body = (
    <Card variant={hasLaunchUrl ? "interactive" : "outlined"} size="compact">
      <Stack align="center" gap="sm">
        <html.div style={styles.icon}>
          <Icon svg={app.icon} size={32} />
        </html.div>
        <Text variant="label">{app.name}</Text>
        {!hasLaunchUrl && (
          <Text variant="bodySm" color="muted">
            {t("home.appCard.noLaunchUrl")}
          </Text>
        )}
      </Stack>
    </Card>
  )

  if (!hasLaunchUrl) return body
  return (
    <html.a href={app.url} style={styles.link} {...linkProps}>
      {body}
    </html.a>
  )
}
