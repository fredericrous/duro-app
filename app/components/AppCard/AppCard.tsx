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
})

interface AppCardProps {
  app: AppDefinition
}

export function AppCard({ app }: AppCardProps) {
  return (
    <html.a href={app.url} style={styles.link} target="_blank" rel="noopener noreferrer">
      <Card variant="interactive" size="compact">
        <Stack align="center" gap="sm">
          <html.div style={styles.icon}>
            <Icon svg={app.icon} size={32} />
          </html.div>
          <Text variant="label">{app.name}</Text>
        </Stack>
      </Card>
    </html.a>
  )
}
