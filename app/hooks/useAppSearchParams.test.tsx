import { describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router"
import type { ReactNode } from "react"
import { useAppSearchParams, shouldRevalidateAppSearch } from "./useAppSearchParams"

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

  it("setQuery writes `q` to the URL once typing settles (and clears it on empty)", () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useWithLocation("cat"), {
      wrapper: withRouter("/"),
    })

    act(() => result.current.hook.setQuery("plex"))
    act(() => void vi.runAllTimers())
    expect(result.current.location.search).toBe("?q=plex")

    act(() => result.current.hook.setQuery(""))
    act(() => void vi.runAllTimers())
    expect(result.current.location.search).toBe("")
    vi.useRealTimers()
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

  it("echoes typing immediately, without waiting on the URL", () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useWithLocation("cat"), {
      wrapper: withRouter("/"),
    })
    // The field reads from local state, so the character is there in the same
    // commit as the keystroke — it never waits for a navigation to land.
    act(() => result.current.hook.setQuery("p"))
    expect(result.current.hook.query).toBe("p")
    expect(result.current.location.search).toBe("")

    act(() => result.current.hook.setQuery("pl"))
    expect(result.current.hook.query).toBe("pl")

    act(() => void vi.runAllTimers())
    expect(result.current.location.search).toBe("?q=pl")
    vi.useRealTimers()
  })

  it("keeps every character when the URL lags behind the keyboard", () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useWithLocation("cat"), {
      wrapper: withRouter("/"),
    })
    // Regression: the URL only ever catches up to an earlier keystroke, and
    // adopting it as an "external" change used to overwrite the newer local
    // value — so fast typing lost characters, worst on the slowest links.
    for (const value of ["v", "va", "vau", "vaul", "vault"]) {
      act(() => result.current.hook.setQuery(value))
      act(() => void vi.advanceTimersByTime(50))
    }
    expect(result.current.hook.query).toBe("vault")

    act(() => void vi.runAllTimers())
    expect(result.current.hook.query).toBe("vault")
    expect(result.current.location.search).toBe("?q=vault")
    vi.useRealTimers()
  })

  it("follows the URL when q changes from outside the field", () => {
    const { result, rerender } = renderHook(() => useWithLocation("cat"), {
      wrapper: withRouter("/?q=plex"),
    })
    expect(result.current.hook.query).toBe("plex")

    // Back/forward or a link into the page carrying its own query: local state
    // must not win over that.
    act(() => result.current.hook.clearAll())
    rerender()
    expect(result.current.hook.query).toBe("")
    expect(result.current.location.search).toBe("")
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

describe("shouldRevalidateAppSearch", () => {
  const args = (current: string, next: string, extra: Record<string, unknown> = {}) =>
    ({
      currentUrl: new URL(current, "https://duro.test"),
      nextUrl: new URL(next, "https://duro.test"),
      defaultShouldRevalidate: true,
      ...extra,
    }) as never

  it("skips the refetch when only the query changed", () => {
    expect(shouldRevalidateAppSearch(args("/catalog", "/catalog?q=p"))).toBe(false)
    expect(shouldRevalidateAppSearch(args("/catalog?q=p", "/catalog?q=pl"))).toBe(false)
  })

  it("skips the refetch when only chip selection changed", () => {
    expect(shouldRevalidateAppSearch(args("/home?cat=media", "/home?cat=tools"))).toBe(false)
    expect(shouldRevalidateAppSearch(args("/catalog", "/catalog?state=pending&state=open"))).toBe(false)
  })

  it("still refetches when any other param changes", () => {
    expect(shouldRevalidateAppSearch(args("/catalog?q=p", "/catalog?q=p&page=2"))).toBe(true)
  })

  it("still refetches when the path changes", () => {
    expect(shouldRevalidateAppSearch(args("/home?q=p", "/catalog?q=p"))).toBe(true)
  })

  it("never suppresses the revalidation that follows a mutation", () => {
    // Requesting access POSTs to the same URL — that result has to land.
    expect(shouldRevalidateAppSearch(args("/home?q=p", "/home?q=p", { formMethod: "POST" }))).toBe(true)
  })
})
