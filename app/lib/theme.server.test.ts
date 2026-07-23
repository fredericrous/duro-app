import { describe, expect, it } from "vitest"
import { resolveTheme, themeCookieHeader, isThemeChoice, DEFAULT_THEME } from "./theme.server"

const req = (cookie?: string) => new Request("https://x.test", cookie ? { headers: { Cookie: cookie } } : undefined)

describe("resolveTheme", () => {
  it("reads a valid theme from the cookie", () => {
    expect(resolveTheme(req("__duro_theme=light"))).toBe("light")
    expect(resolveTheme(req("a=1; __duro_theme=dark; b=2"))).toBe("dark")
  })

  it("falls back to the default when the cookie is missing or invalid", () => {
    expect(resolveTheme(req())).toBe(DEFAULT_THEME)
    expect(resolveTheme(req("__duro_theme=neon"))).toBe(DEFAULT_THEME)
  })
})

describe("isThemeChoice", () => {
  it("accepts only known themes", () => {
    expect(isThemeChoice("dark")).toBe(true)
    expect(isThemeChoice("light")).toBe(true)
    expect(isThemeChoice("system")).toBe(false)
    expect(isThemeChoice(null)).toBe(false)
  })
})

describe("themeCookieHeader", () => {
  it("sets a long-lived, path-wide cookie", () => {
    const header = themeCookieHeader("light")
    expect(header).toContain("__duro_theme=light")
    expect(header).toContain("Path=/")
    expect(header).toMatch(/Max-Age=\d+/)
  })
})
