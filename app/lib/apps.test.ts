import { describe, it, expect } from "vitest"
import { groupAppsByCategory, getCategoryOrder, formatCategory } from "./apps"
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

describe("getCategoryOrder", () => {
  it("sorts categories by lowest priority in each", () => {
    const apps = [
      makeApp({ id: "a", category: "admin", priority: 50 }),
      makeApp({ id: "b", category: "media", priority: 1 }),
      makeApp({ id: "c", category: "media", priority: 10 }),
      makeApp({ id: "d", category: "ai", priority: 5 }),
    ]
    expect(getCategoryOrder(apps)).toEqual(["media", "ai", "admin"])
  })

  it("returns empty array for no apps", () => {
    expect(getCategoryOrder([])).toEqual([])
  })

  it("handles single category", () => {
    const apps = [makeApp({ id: "a", category: "storage", priority: 1 })]
    expect(getCategoryOrder(apps)).toEqual(["storage"])
  })
})

describe("formatCategory", () => {
  it("capitalizes the first letter", () => {
    expect(formatCategory("media")).toBe("Media")
    expect(formatCategory("ai")).toBe("Ai")
    expect(formatCategory("automation")).toBe("Automation")
  })
})
