import type { AppDefinition, Category } from "~/lib/apps";
import { categoryLabels, categoryOrder, groupAppsByCategory } from "~/lib/apps";
import { AppCard } from "../AppCard/AppCard";
import styles from "./AppGrid.module.css";

interface AppGridProps {
  apps: AppDefinition[];
}

export function AppGrid({ apps }: AppGridProps) {
  const grouped = groupAppsByCategory(apps);

  return (
    <div className={styles.container}>
      {categoryOrder.map((category) => {
        const categoryApps = grouped.get(category);
        if (!categoryApps || categoryApps.length === 0) return null;

        return (
          <section key={category} className={styles.section}>
            <h2 className={styles.categoryTitle}>{categoryLabels[category]}</h2>
            <div className={styles.grid}>
              {categoryApps.map((app) => (
                <AppCard key={app.id} app={app} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
