/**
 * Theme preference, resolved SSR-side from a cookie so the very first paint is
 * already in the chosen theme (no flash) — mirrors the locale cookie pattern.
 * Persisted to `user_preferences` too, for cross-device durability.
 *
 * Only the explicit themes (dark/light) are cookie-driven today; "system"
 * (follow the device) needs a before-paint resolve step and is a follow-up.
 */
export type ThemeChoice = "dark" | "light"

const COOKIE_NAME = "__duro_theme"
const THEMES: readonly ThemeChoice[] = ["dark", "light"]
export const DEFAULT_THEME: ThemeChoice = "dark"

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value)
}

export function resolveTheme(request: Request): ThemeChoice {
  const cookies = request.headers.get("Cookie") ?? ""
  const match = cookies.match(new RegExp(`${COOKIE_NAME}=([^;]+)`))
  return match && isThemeChoice(match[1]) ? match[1] : DEFAULT_THEME
}

export function themeCookieHeader(theme: ThemeChoice): string {
  // Not HttpOnly: harmless to read client-side, and leaves room for a future
  // client-resolved "system" mode.
  return `${COOKIE_NAME}=${theme}; Path=/; SameSite=Lax; Max-Age=31536000`
}
