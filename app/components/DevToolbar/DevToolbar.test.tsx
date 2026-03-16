import { describe, it, expect } from "vitest"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { DevToolbar, useDevOverrides } from "./DevToolbar"

function OverridesConsumer() {
  const overrides = useDevOverrides()
  return <span data-testid="cert">{String(overrides?.certInstalled ?? "null")}</span>
}

describe("DevToolbar", () => {
  it("renders children content", () => {
    render(
      <DevToolbar>
        <span>App Content</span>
      </DevToolbar>,
    )
    expect(screen.getByText("App Content")).toBeInTheDocument()
  })

  it("shows DEV header and Certificate switch", () => {
    render(
      <DevToolbar>
        <div data-testid="children" />
      </DevToolbar>,
    )
    expect(screen.getByText("DEV")).toBeInTheDocument()
    expect(screen.getByText("Certificate")).toBeInTheDocument()
    expect(screen.getByRole("switch")).toBeInTheDocument()
  })

  it("toggles certInstalled via switch", async () => {
    const user = userEvent.setup()
    render(
      <DevToolbar>
        <OverridesConsumer />
      </DevToolbar>,
    )

    expect(screen.getByTestId("cert")).toHaveTextContent("false")

    await user.click(screen.getByRole("switch"))

    expect(screen.getByTestId("cert")).toHaveTextContent("true")
  })

  it("useDevOverrides returns null outside provider", () => {
    render(<OverridesConsumer />)
    expect(screen.getByTestId("cert")).toHaveTextContent("null")
  })
})
