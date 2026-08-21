import { afterEach, describe, expect, it, vi } from "vitest"
import { renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { LinkTargetProvider, useLinkTarget } from "./useLinkTarget"
import { COMPUTER_QUERY, INSTALLED_QUERY, type LinkTargetMode } from "~/lib/link-target"

/**
 * QUERY-AWARE stub. The global one in app/test/setup.ts answers `matches: true`
 * to every query, which would make "auto" resolve to a new tab in every test
 * regardless of the device being simulated — the exact bug these tests exist
 * to catch. This one answers per query.
 */
function mockDevice({ computer, installed }: { computer: boolean; installed: boolean }) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === COMPUTER_QUERY ? computer : query === INSTALLED_QUERY ? installed : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

const render = (mode: LinkTargetMode) =>
  renderHook(() => useLinkTarget(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <LinkTargetProvider value={mode}>{children}</LinkTargetProvider>
    ),
  })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("useLinkTarget", () => {
  describe("auto", () => {
    it("opens a new tab on a computer", () => {
      mockDevice({ computer: true, installed: false })
      expect(render("auto").result.current).toEqual({ target: "_blank", rel: "noopener noreferrer" })
    })

    it("stays in place on a handheld or TV", () => {
      // Coarse pointer, no hover: phone, tablet, TV remote, watch.
      mockDevice({ computer: false, installed: false })
      expect(render("auto").result.current).toEqual({})
    })

    it("stays in place when installed, even on a computer", () => {
      // A standalone window has no tabs to open into — _blank would fling the
      // user out to the browser.
      mockDevice({ computer: true, installed: true })
      expect(render("auto").result.current).toEqual({})
    })
  })

  describe("explicit modes ignore the device", () => {
    it("new_tab stays a new tab on a phone", () => {
      mockDevice({ computer: false, installed: false })
      expect(render("new_tab").result.current).toEqual({ target: "_blank", rel: "noopener noreferrer" })
    })

    it("same_tab stays in place on a computer", () => {
      mockDevice({ computer: true, installed: false })
      expect(render("same_tab").result.current).toEqual({})
    })
  })

  it("works unwrapped, defaulting to same-tab", () => {
    mockDevice({ computer: true, installed: false })
    // Context default, not a router hook — components render fine outside the
    // dashboard layout, and the default never opts anyone into new tabs.
    expect(renderHook(() => useLinkTarget()).result.current).toEqual({})
  })

  it("keeps a stable identity across renders", () => {
    mockDevice({ computer: true, installed: false })
    const { result, rerender } = render("new_tab")
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })
})
