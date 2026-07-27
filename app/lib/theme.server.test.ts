import { describe, expect, it } from "vitest"
import {
  resolveTheme,
  resolveThemePreference,
  hasThemeCookie,
  themeCookieHeader,
  isThemeChoice,
  isThemePreference,
  DEFAULT_THEME,
} from "./theme.server"

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

  it("resolves 'system' from the device scheme cookie", () => {
    expect(resolveTheme(req("__duro_theme=system; __duro_scheme=light"))).toBe("light")
    expect(resolveTheme(req("__duro_theme=system; __duro_scheme=dark"))).toBe("dark")
  })

  it("resolves 'system' to the default when the scheme cookie is missing or invalid", () => {
    expect(resolveTheme(req("__duro_theme=system"))).toBe(DEFAULT_THEME)
    expect(resolveTheme(req("__duro_theme=system; __duro_scheme=sepia"))).toBe(DEFAULT_THEME)
  })
})

describe("resolveThemePreference", () => {
  it("returns the raw preference, including system", () => {
    expect(resolveThemePreference(req("__duro_theme=system"))).toBe("system")
    expect(resolveThemePreference(req("__duro_theme=light"))).toBe("light")
    expect(resolveThemePreference(req())).toBe(DEFAULT_THEME)
  })
})

describe("hasThemeCookie", () => {
  it("detects only valid preference cookies", () => {
    expect(hasThemeCookie(req("__duro_theme=system"))).toBe(true)
    expect(hasThemeCookie(req("__duro_theme=neon"))).toBe(false)
    expect(hasThemeCookie(req())).toBe(false)
  })
})

describe("isThemeChoice", () => {
  it("accepts only concrete themes", () => {
    expect(isThemeChoice("dark")).toBe(true)
    expect(isThemeChoice("light")).toBe(true)
    expect(isThemeChoice("system")).toBe(false)
    expect(isThemeChoice(null)).toBe(false)
  })
})

describe("isThemePreference", () => {
  it("accepts system as a preference", () => {
    expect(isThemePreference("dark")).toBe(true)
    expect(isThemePreference("light")).toBe(true)
    expect(isThemePreference("system")).toBe(true)
    expect(isThemePreference("neon")).toBe(false)
    expect(isThemePreference(null)).toBe(false)
  })
})

describe("themeCookieHeader", () => {
  it("sets a long-lived, path-wide cookie", () => {
    const header = themeCookieHeader("light")
    expect(header).toContain("__duro_theme=light")
    expect(header).toContain("Path=/")
    expect(header).toMatch(/Max-Age=\d+/)
  })

  it("accepts the system preference", () => {
    expect(themeCookieHeader("system")).toContain("__duro_theme=system")
  })
})
