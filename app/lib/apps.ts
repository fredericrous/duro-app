export type Category = "media" | "ai" | "productivity" | "development" | "admin"

export interface AppDefinition {
  id: string
  name: string
  url: string
  category: Category
  icon: string
  groups: string[]
  priority: number
}

export function groupAppsByCategory(visibleApps: AppDefinition[]): Map<Category, AppDefinition[]> {
  const grouped = new Map<Category, AppDefinition[]>()

  for (const app of visibleApps) {
    const existing = grouped.get(app.category) || []
    existing.push(app)
    grouped.set(app.category, existing)
  }

  return grouped
}

export const categoryLabels: Record<Category, string> = {
  media: "Media",
  ai: "AI",
  productivity: "Productivity",
  development: "Development",
  admin: "Admin",
}

export const categoryOrder: Category[] = ["media", "ai", "productivity", "development", "admin"]
