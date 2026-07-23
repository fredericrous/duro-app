import { describe, expect, it } from "vitest"
import { renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { DisplayPrefsProvider, useDisplayFormat } from "./useDisplayFormat"

const INSTANT = "2026-01-15T23:30:00Z" // 23:30 UTC

describe("useDisplayFormat", () => {
  it("formats using the provided timezone + clock preference", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DisplayPrefsProvider value={{ timezone: "Asia/Tokyo", timeFormat: "24" }}>{children}</DisplayPrefsProvider>
    )
    const { result } = renderHook(() => useDisplayFormat(), { wrapper })
    // Tokyo is UTC+9 → 23:30 UTC renders as 08:30 the next day.
    expect(result.current.formatDateTime(INSTANT)).toMatch(/8:30/)
    expect(result.current.formatDate(INSTANT)).toMatch(/16/)
  })

  it("falls back to runtime defaults when no provider is present", () => {
    const { result } = renderHook(() => useDisplayFormat())
    // No throw (context default, not a router hook) + still produces a date.
    expect(result.current.formatDate(INSTANT)).toMatch(/2026/)
    expect(result.current.formatDateTime("bogus")).toBe("")
  })
})
