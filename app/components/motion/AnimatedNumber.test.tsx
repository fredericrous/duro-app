import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { AnimatedNumber } from "./AnimatedNumber"

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

describe("AnimatedNumber", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it("renders its value on first mount without animating", () => {
    mockMatchMedia(false)
    render(<AnimatedNumber value={42} />)
    expect(screen.getByText("42")).toBeInTheDocument()
  })

  it("jumps straight to the new value when reduced motion is preferred", async () => {
    mockMatchMedia(true)
    const { rerender } = render(<AnimatedNumber value={3} />)
    expect(screen.getByText("3")).toBeInTheDocument()

    rerender(<AnimatedNumber value={9} />)
    expect(await screen.findByText("9")).toBeInTheDocument()
    expect(screen.queryByText("3")).not.toBeInTheDocument()
  })
})
