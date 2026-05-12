import { describe, expect, it } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router"
import type { ReactNode } from "react"
import { useAppSearchParams } from "./useAppSearchParams"

/**
 * Wrap renderHook in a MemoryRouter so useSearchParams resolves. Tests run
 * under a "/" route that re-renders on any URL change — important because
 * useDeferredValue and setSearchParams updates are otherwise invisible.
 */
function withRouter(initialUrl: string) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initialUrl]}>
      <Routes>
        <Route path="*" element={<>{children}</>} />
      </Routes>
    </MemoryRouter>
  )
}

/**
 * Probe component to read the current location alongside the hook so we can
 * assert URL mutations after setQuery / setSelected / clearAll.
 */
function useWithLocation(chip: "cat" | "state") {
  return { hook: useAppSearchParams(chip), location: useLocation() }
}

describe("useAppSearchParams", () => {
  it("parses query and chip values from the URL on mount", () => {
    const { result } = renderHook(() => useAppSearchParams("cat"), {
      wrapper: withRouter("/?q=jelly&cat=media&cat=tools"),
    })
    expect(result.current.query).toBe("jelly")
    expect(result.current.deferredQuery).toBe("jelly")
    expect(result.current.selected).toEqual(["media", "tools"])
  })

  it("returns empty values when no params are present", () => {
    const { result } = renderHook(() => useAppSearchParams("state"), {
      wrapper: withRouter("/"),
    })
    expect(result.current.query).toBe("")
    expect(result.current.selected).toEqual([])
  })

  it("setQuery writes `q` to the URL (and clears it on empty)", () => {
    const { result } = renderHook(() => useWithLocation("cat"), {
      wrapper: withRouter("/"),
    })

    act(() => result.current.hook.setQuery("plex"))
    expect(result.current.location.search).toBe("?q=plex")

    act(() => result.current.hook.setQuery(""))
    expect(result.current.location.search).toBe("")
  })

  it("setSelected writes multiple chip values (repeated key)", () => {
    const { result } = renderHook(() => useWithLocation("cat"), {
      wrapper: withRouter("/"),
    })

    act(() => result.current.hook.setSelected(["media", "tools"]))
    const params = new URLSearchParams(result.current.location.search)
    expect(params.getAll("cat")).toEqual(["media", "tools"])
  })

  it("setSelected replaces previous values (no accumulation)", () => {
    const { result } = renderHook(() => useWithLocation("cat"), {
      wrapper: withRouter("/?cat=media&cat=tools"),
    })

    act(() => result.current.hook.setSelected(["productivity"]))
    const params = new URLSearchParams(result.current.location.search)
    expect(params.getAll("cat")).toEqual(["productivity"])
  })

  it("setSelected with empty array clears all chips", () => {
    const { result } = renderHook(() => useWithLocation("state"), {
      wrapper: withRouter("/?q=foo&state=pending&state=open"),
    })

    act(() => result.current.hook.setSelected([]))
    const params = new URLSearchParams(result.current.location.search)
    expect(params.getAll("state")).toEqual([])
    // `q` is preserved
    expect(params.get("q")).toBe("foo")
  })

  it("clearAll removes both q and chip values, preserving unrelated keys", () => {
    const { result } = renderHook(() => useWithLocation("cat"), {
      wrapper: withRouter("/?q=plex&cat=media&page=2"),
    })

    act(() => result.current.hook.clearAll())
    const params = new URLSearchParams(result.current.location.search)
    expect(params.get("q")).toBeNull()
    expect(params.getAll("cat")).toEqual([])
    // unrelated params survive
    expect(params.get("page")).toBe("2")
  })

  it("uses the chipParam argument to scope reads + writes", () => {
    const { result } = renderHook(() => useWithLocation("state"), {
      wrapper: withRouter("/?cat=media&state=requestable"),
    })
    // Hook only sees its own chip param
    expect(result.current.hook.selected).toEqual(["requestable"])

    act(() => result.current.hook.setSelected(["pending"]))
    const params = new URLSearchParams(result.current.location.search)
    // Foreign cat= is left untouched
    expect(params.get("cat")).toBe("media")
    expect(params.getAll("state")).toEqual(["pending"])
  })
})
