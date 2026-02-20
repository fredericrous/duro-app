export interface AppDefinition {
  id: string
  name: string
  url: string
  category: string
  icon: string
  groups: string[]
  priority: number
}

export function groupAppsByCategory(apps: AppDefinition[]): Map<string, AppDefinition[]> {
  const grouped = new Map<string, AppDefinition[]>()

  for (const app of apps) {
    const existing = grouped.get(app.category) || []
    existing.push(app)
    grouped.set(app.category, existing)
  }

  return grouped
}

/** Derive ordered category list from apps, sorted by the lowest priority value in each category. */
export function getCategoryOrder(apps: AppDefinition[]): string[] {
  const minPriority = new Map<string, number>()

  for (const app of apps) {
    const current = minPriority.get(app.category)
    if (current === undefined || app.priority < current) {
      minPriority.set(app.category, app.priority)
    }
  }

  return [...minPriority.entries()].sort(([, a], [, b]) => a - b).map(([cat]) => cat)
}

/** Capitalize a category slug for display (fallback when no i18n key exists). */
export function formatCategory(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1)
}
