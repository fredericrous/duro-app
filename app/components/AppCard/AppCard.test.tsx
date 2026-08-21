import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { AppCard } from "./AppCard"
import { LinkTargetProvider } from "~/hooks/useLinkTarget"
import { t } from "~/test/test-utils"
import type { AppDefinition } from "~/lib/apps"

const app = (over: Partial<AppDefinition> = {}): AppDefinition =>
  ({
    id: "plex",
    name: "Plex",
    url: "https://plex.example.com",
    category: "media",
    icon: "<svg/>",
    groups: [],
    priority: 1,
    ...over,
  }) as AppDefinition

const inProvider = (value: boolean, node: ReactNode) => <LinkTargetProvider value={value}>{node}</LinkTargetProvider>

describe("AppCard", () => {
  it("navigates in the same tab by default", () => {
    // Rendered with NO provider — proves both the same-tab default and that the
    // context default lets the card render outside the dashboard layout.
    render(<AppCard app={app()} />)
    const link = screen.getByRole("link", { name: /Plex/ })
    expect(link).toHaveAttribute("href", "https://plex.example.com")
    expect(link).not.toHaveAttribute("target")
    expect(link).not.toHaveAttribute("rel")
  })

  it("opens a new tab when the user turned the preference on", () => {
    render(inProvider(true, <AppCard app={app()} />))
    const link = screen.getByRole("link", { name: /Plex/ })
    // Both asserted here: this is the guard against target and rel drifting apart.
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
  })

  it.each(["#", ""])("renders no link at all when the app has no launch URL (%j)", (url) => {
    render(inProvider(true, <AppCard app={app({ url })} />))
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
    expect(screen.getByText(t("home.appCard.noLaunchUrl"))).toBeInTheDocument()
  })
})
