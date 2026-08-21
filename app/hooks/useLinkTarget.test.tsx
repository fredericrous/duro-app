import { describe, expect, it } from "vitest"
import { renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { LinkTargetProvider, useLinkTarget } from "./useLinkTarget"

const wrapWith = (value: boolean) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <LinkTargetProvider value={value}>{children}</LinkTargetProvider>
  }

describe("useLinkTarget", () => {
  it("returns target AND rel together when the user opted into new tabs", () => {
    const { result } = renderHook(() => useLinkTarget(), { wrapper: wrapWith(true) })
    // Asserted as one object on purpose: the pair is the whole point, and a
    // target that ever ships without its rel is a reverse-tabnabbing hole.
    expect(result.current).toEqual({ target: "_blank", rel: "noopener noreferrer" })
  })

  it("returns nothing to spread when the preference is off", () => {
    const { result } = renderHook(() => useLinkTarget(), { wrapper: wrapWith(false) })
    expect(result.current).toEqual({})
    // Explicitly NOT "_self": spreading that onto an anchor is a behaviour
    // change of its own (it defeats a <base target>), so absence is the default.
    expect(result.current.target).toBeUndefined()
    expect(result.current.rel).toBeUndefined()
  })

  it("works unwrapped, defaulting to same-tab", () => {
    // Context default, not a router hook — so components using it render fine
    // outside the dashboard layout, including in unit tests.
    const { result } = renderHook(() => useLinkTarget())
    expect(result.current).toEqual({})
  })

  it("keeps a stable identity across renders", () => {
    // Frozen module-level constants: consumers never re-render just because
    // this hook ran again.
    const { result, rerender } = renderHook(() => useLinkTarget(), { wrapper: wrapWith(true) })
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })
})
