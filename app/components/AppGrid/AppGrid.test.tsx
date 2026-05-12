import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { AppGrid } from "./AppGrid"
import type { AppDefinition } from "~/lib/apps"

// react-router's Link is the only dependency that needs stubbing — AppCard
// uses it for the "open app" anchor.
vi.mock("react-router", () => ({
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

const app = (overrides: Partial<AppDefinition> & Pick<AppDefinition, "id" | "category">): AppDefinition => ({
  name: overrides.id,
  url: `https://${overrides.id}.example.com`,
  icon: "<svg/>",
  groups: [],
  priority: 0,
  ...overrides,
})

describe("AppGrid", () => {
  it("renders nothing when given an empty apps list", () => {
    const { container } = render(<AppGrid apps={[]} />)
    // Stack renders as a div even when empty; no app cards present.
    expect(container.querySelectorAll("a").length).toBe(0)
    expect(container.querySelectorAll("section").length).toBe(0)
  })

  it("groups apps by category and renders one section per non-empty category", () => {
    render(
      <AppGrid
        apps={[
          app({ id: "plex", category: "media" }),
          app({ id: "sonarr", category: "media" }),
          app({ id: "grafana", category: "admin" }),
        ]}
      />,
    )

    // Two category sections.
    const sections = document.querySelectorAll("section")
    expect(sections.length).toBe(2)
    // App links rendered for each item.
    expect(screen.getByText("plex")).toBeInTheDocument()
    expect(screen.getByText("sonarr")).toBeInTheDocument()
    expect(screen.getByText("grafana")).toBeInTheDocument()
  })

  it("respects categoryOrder when provided (admin first, then media)", () => {
    render(
      <AppGrid
        apps={[app({ id: "plex", category: "media" }), app({ id: "grafana", category: "admin" })]}
        categoryOrder={["admin", "media"]}
      />,
    )

    const sections = Array.from(document.querySelectorAll("section"))
    // Section ordering follows categoryOrder.
    const firstSectionText = sections[0]?.textContent ?? ""
    const secondSectionText = sections[1]?.textContent ?? ""
    expect(firstSectionText).toContain("grafana")
    expect(secondSectionText).toContain("plex")
  })

  it("falls back to alphabetical when no categoryOrder is given", () => {
    render(<AppGrid apps={[app({ id: "plex", category: "media" }), app({ id: "grafana", category: "admin" })]} />)
    const sections = Array.from(document.querySelectorAll("section"))
    // 'admin' sorts before 'media' alphabetically.
    expect(sections[0]?.textContent).toContain("grafana")
    expect(sections[1]?.textContent).toContain("plex")
  })

  it("uses the formatCategory fallback when no i18n key matches", () => {
    render(<AppGrid apps={[app({ id: "x", category: "obscure-category" })]} />)
    // formatCategory capitalizes the slug.
    expect(screen.getByText("Obscure-category")).toBeInTheDocument()
  })
})
