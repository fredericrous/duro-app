import { useTranslation } from "react-i18next"
import type { AppDefinition } from "~/lib/apps"
import { Card, Stack, Text } from "@duro-app/ui"
import { Icon } from "../Icon"
import { css, html } from "react-strict-dom"

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
    color: "#6aaffc", // tokens.colors.accent — can't use css.defineVars ref in Metro
  },
  // Center + clamp the description so long copy doesn't blow out card height.
  description: {
    display: "block",
    textAlign: "center",
  },
})

interface AppCardProps {
  app: AppDefinition
}

export function AppCard({ app }: AppCardProps) {
  const { t } = useTranslation()
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
        {app.description ? (
          <html.span style={styles.description}>
            <Text variant="bodySm" color="muted">
              {app.description}
            </Text>
          </html.span>
        ) : null}
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
    <html.a href={app.url} style={styles.link} target="_blank" rel="noopener noreferrer">
      {body}
    </html.a>
  )
}
