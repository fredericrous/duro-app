import { describe, expect, it } from "vitest"
import { html } from "react-strict-dom"

/**
 * The react-strict-dom mock is installed globally by setup.ts. Its `html.*`
 * proxy must hand back the SAME component for a given tag every time.
 *
 * A fresh component per access looks harmless — the markup is identical — but
 * React reconciles by element type, so a new type on each render means every
 * re-render unmounts and remounts the subtree instead of updating it. Child
 * state resets silently, and a subtree that registers a router fetcher on mount
 * never settles: the new fetcher updates router state, which re-renders, which
 * remounts, forever. That cost the cert reveal page its whole click-through
 * test coverage until it was found.
 */
describe("react-strict-dom mock", () => {
  it("returns a stable component type per tag", () => {
    expect(html.div).toBe(html.div)
    expect(html.main).toBe(html.main)
    expect(html.div).not.toBe(html.span)
  })
})
