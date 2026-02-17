import type { AppDefinition } from "~/lib/apps";
import { Icon } from "../Icon";
import styles from "./AppCard.module.css";

interface AppCardProps {
  app: AppDefinition;
}

export function AppCard({ app }: AppCardProps) {
  return (
    <a href={app.url} className={styles.card} target="_blank" rel="noopener noreferrer">
      <div className={styles.icon}>
        <Icon svg={app.icon} size={32} />
      </div>
      <span className={styles.name}>{app.name}</span>
    </a>
  );
}
