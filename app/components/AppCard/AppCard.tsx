import type { AppDefinition } from "~/lib/apps"
import { Card, Text } from "@duro-app/ui"
import { Icon } from "../Icon"
import styles from "./AppCard.module.css"

interface AppCardProps {
  app: AppDefinition
}

export function AppCard({ app }: AppCardProps) {
  return (
    <a href={app.url} className={styles.link} target="_blank" rel="noopener noreferrer">
      <Card variant="interactive" size="compact">
        <div className={styles.content}>
          <div className={styles.icon}>
            <Icon svg={app.icon} size={32} />
          </div>
          <Text variant="label">{app.name}</Text>
        </div>
      </Card>
    </a>
  )
}
