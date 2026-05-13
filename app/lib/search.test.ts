// @vitest-environment node
import { describe, expect, it } from "vitest"
import { filterByQuery } from "./search"

interface Item {
  id: string
  name: string
  description: string
}

const items: Item[] = [
  { id: "1", name: "Jellyfin", description: "Self-hosted media server" },
  { id: "2", name: "Navidrome", description: "Music streaming" },
  { id: "3", name: "Vaultwarden", description: "Password manager" },
  { id: "4", name: "Gitea", description: "Git hosting service" },
]

describe("filterByQuery", () => {
  it("returns a fresh copy when query is empty", () => {
    const result = filterByQuery(items, "", ["name"])
    expect(result).toHaveLength(items.length)
    // Mutating the result must not affect the original
    expect(result).not.toBe(items)
    result.pop()
    expect(items).toHaveLength(4)
  })

  it("returns a fresh copy when query is whitespace-only", () => {
    const result = filterByQuery(items, "   ", ["name"])
    expect(result).toHaveLength(items.length)
  })

  it("matches case-insensitively against a string key", () => {
    const result = filterByQuery(items, "jelly", ["name"])
    expect(result.map((x) => x.id)).toEqual(["1"])
  })

  it("tolerates a one-character typo and ranks the best match first", () => {
    // match-sorter scores word-start > substring > acronym. "Naidrome"
    // should still find Navidrome through partial substring matching.
    const result = filterByQuery(items, "naidrome", ["name"])
    expect(result.length).toBeGreaterThan(0)
    expect(result[0].id).toBe("2")
  })

  it("matches against multiple keys", () => {
    const result = filterByQuery(items, "music", ["name", "description"])
    expect(result.map((x) => x.id)).toEqual(["2"])
  })

  it("accepts function-shaped key accessors for nested data", () => {
    type Nested = { app: { displayName: string } }
    const nested: Nested[] = [
      { app: { displayName: "Linear" } },
      { app: { displayName: "Linkerd" } },
      { app: { displayName: "Nginx" } },
    ]
    const result = filterByQuery(nested, "linear", [(n) => n.app.displayName])
    expect(result).toHaveLength(1)
    expect(result[0].app.displayName).toBe("Linear")
  })

  it("ranks word-start matches above mid-word matches", () => {
    const corpus: Item[] = [
      { id: "a", name: "Plex", description: "media app" },
      { id: "b", name: "Complex", description: "" },
    ]
    const result = filterByQuery(corpus, "plex", ["name"])
    // Both contain "plex", but the word-start match should win.
    expect(result[0].id).toBe("a")
  })
})
