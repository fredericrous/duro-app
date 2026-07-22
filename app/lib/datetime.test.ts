import { describe, expect, it } from "vitest"
import { formatDateTime, formatDate, prefToSelect, selectToPref, AUTO } from "./datetime"

const INSTANT = "2026-01-15T23:30:00Z" // 23:30 UTC

describe("formatDateTime", () => {
  it("renders the instant in the requested timezone (24h)", () => {
    const out = formatDateTime(INSTANT, { timezone: "UTC", timeFormat: "24", locale: "en-GB" })
    expect(out).toMatch(/23:30/)
    expect(out).toMatch(/2026/)
  })

  it("shifts the wall-clock time by timezone", () => {
    // Tokyo is UTC+9 → 23:30 UTC is 08:30 next day.
    const out = formatDateTime(INSTANT, { timezone: "Asia/Tokyo", timeFormat: "24", locale: "en-GB" })
    expect(out).toMatch(/8:30/)
    expect(out).toMatch(/16/) // Jan 16 in Tokyo
  })

  it("honours the 12-hour clock preference", () => {
    const out = formatDateTime(INSTANT, { timezone: "UTC", timeFormat: "12", locale: "en-US" })
    expect(out).toMatch(/11:30/)
    expect(out.toLowerCase()).toMatch(/pm/)
  })

  it("returns empty string for invalid input", () => {
    expect(formatDateTime("not-a-date")).toBe("")
  })

  it("does not throw on a bogus timezone", () => {
    expect(() => formatDateTime(INSTANT, { timezone: "Not/AZone" })).not.toThrow()
  })
})

describe("formatDate", () => {
  it("renders the calendar day in the given timezone without a clock", () => {
    const out = formatDate(INSTANT, { timezone: "Asia/Tokyo" })
    expect(out).toMatch(/16/) // rolled to Jan 16 in Tokyo
    expect(out).not.toMatch(/:/) // no time component
  })

  it("returns empty string for invalid input", () => {
    expect(formatDate("nope")).toBe("")
  })
})

describe("pref <-> select mapping", () => {
  it("maps a null pref to the AUTO sentinel and back", () => {
    expect(prefToSelect(null)).toBe(AUTO)
    expect(prefToSelect(undefined)).toBe(AUTO)
    expect(selectToPref(AUTO)).toBeNull()
  })

  it("passes concrete values through unchanged", () => {
    expect(prefToSelect("Europe/Paris")).toBe("Europe/Paris")
    expect(selectToPref("Europe/Paris")).toBe("Europe/Paris")
    expect(selectToPref("24")).toBe("24")
  })
})
