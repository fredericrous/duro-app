import { useTranslation } from "react-i18next"
import type { AppDefinition } from "~/lib/apps"
import { getCategoryOrder, formatCategory, groupAppsByCategory } from "~/lib/apps"
import { Grid, Stack, Text } from "@duro-app/ui"
import { AppCard } from "../AppCard/AppCard"

interface AppGridProps {
  apps: AppDefinition[]
  categoryOrder?: string[]
}

export function AppGrid({ apps, categoryOrder }: AppGridProps) {
  const { t } = useTranslation()
  const grouped = groupAppsByCategory(apps)
  const order = getCategoryOrder(apps, categoryOrder)

  const categoryLabel = (cat: string) => {
    const key = `categories.${cat}`
    const translated = t(key)
    return translated === key ? formatCategory(cat) : translated
  }

  return (
    <Stack gap="xl">
      {order.map((category) => {
        const categoryApps = grouped.get(category)
        if (!categoryApps || categoryApps.length === 0) return null

        return (
          <section key={category}>
            <Stack gap="md">
              <Text variant="overline" color="muted" as="div">
                {categoryLabel(category)}
              </Text>
              <Grid gap="md" minColumnWidth="120px">
                {categoryApps.map((app) => (
                  <AppCard key={app.id} app={app} />
                ))}
              </Grid>
            </Stack>
          </section>
        )
      })}
    </Stack>
  )
}
