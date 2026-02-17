import { describe, it, expect } from "vitest"
import { groupAppsByCategory, categoryOrder, categoryLabels } from "./apps"
import type { AppDefinition } from "./apps"

function makeApp(overrides: Partial<AppDefinition> & Pick<AppDefinition, "id" | "category">): AppDefinition {
  return {
    name: overrides.id,
    url: `https://${overrides.id}.example.com`,
    icon: "default",
    groups: [],
    priority: 0,
    ...overrides,
  }
}

describe("groupAppsByCategory", () => {
  const apps: AppDefinition[] = [
    makeApp({ id: "plex", category: "media" }),
    makeApp({ id: "sonarr", category: "media" }),
    makeApp({ id: "grafana", category: "admin" }),
    makeApp({ id: "code", category: "development" }),
  ]

  it("groups apps by their category", () => {
    const grouped = groupAppsByCategory(apps)
    expect(grouped.get("media")).toHaveLength(2)
    expect(grouped.get("admin")).toHaveLength(1)
    expect(grouped.get("development")).toHaveLength(1)
    expect(grouped.get("ai")).toBeUndefined()
  })

  it("returns empty map for no apps", () => {
    const grouped = groupAppsByCategory([])
    expect(grouped.size).toBe(0)
  })

  it("preserves app order within category", () => {
    const grouped = groupAppsByCategory(apps)
    const mediaApps = grouped.get("media")!
    expect(mediaApps[0].id).toBe("plex")
    expect(mediaApps[1].id).toBe("sonarr")
  })
})

describe("categoryOrder and categoryLabels", () => {
  it("has labels for all ordered categories", () => {
    for (const cat of categoryOrder) {
      expect(categoryLabels[cat]).toBeDefined()
      expect(typeof categoryLabels[cat]).toBe("string")
    }
  })

  it("has all five categories", () => {
    expect(categoryOrder).toHaveLength(5)
  })
})
