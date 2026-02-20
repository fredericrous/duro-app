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

/**
 * Return ordered category list. Uses `configuredOrder` when provided —
 * only categories that actually have apps are kept, and any categories
 * present in apps but missing from the list are appended alphabetically.
 * When no configured order is given, falls back to alphabetical.
 */
export function getCategoryOrder(apps: AppDefinition[], configuredOrder: string[] = []): string[] {
  const present = new Set(apps.map((a) => a.category))

  if (configuredOrder.length === 0) {
    return [...present].sort()
  }

  const ordered = configuredOrder.filter((c) => present.has(c))
  const remaining = [...present].filter((c) => !configuredOrder.includes(c)).sort()
  return [...ordered, ...remaining]
}

/** Capitalize a category slug for display (fallback when no i18n key exists). */
export function formatCategory(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1)
}
