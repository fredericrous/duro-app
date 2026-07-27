/**
 * Theme preference, resolved SSR-side from cookies so the very first paint is
 * already in the chosen theme (no flash) — mirrors the locale cookie pattern.
 * Persisted to `user_preferences` too, for cross-device durability.
 *
 * Two distinct concepts:
 * - ThemePreference ("dark" | "light" | "system") — what the user chose.
 *   Stored in the `__duro_theme` cookie and in `user_preferences.theme`.
 * - ThemeChoice ("dark" | "light") — the concrete resolved theme. This is the
 *   ONLY value ever handed to <ThemeProvider> or written to html[data-theme].
 *
 * "system" resolves against `__duro_scheme`, a client-written cookie holding
 * the device's last-known OS color scheme (refreshed by the pre-paint script
 * in root.tsx on every load), so SSR resolves it correctly from the second
 * request onward. A stale scheme cookie is corrected client-side at hydration
 * by useResolvedTheme.
 */
export type ThemeChoice = "dark" | "light"
export type ThemePreference = ThemeChoice | "system"

const COOKIE_NAME = "__duro_theme"
export const SCHEME_COOKIE = "__duro_scheme"
const THEMES: readonly ThemeChoice[] = ["dark", "light"]
const PREFERENCES: readonly ThemePreference[] = ["dark", "light", "system"]
export const DEFAULT_THEME: ThemeChoice = "dark"

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value)
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (PREFERENCES as readonly string[]).includes(value)
}

function readCookie(request: Request, name: string): string | null {
  const cookies = request.headers.get("Cookie") ?? ""
  const match = cookies.match(new RegExp(`${name}=([^;]+)`))
  return match ? match[1] : null
}

export function resolveThemePreference(request: Request): ThemePreference {
  const raw = readCookie(request, COOKIE_NAME)
  return isThemePreference(raw) ? raw : DEFAULT_THEME
}

/** Whether the request carries an explicit (valid) theme cookie. */
export function hasThemeCookie(request: Request): boolean {
  return isThemePreference(readCookie(request, COOKIE_NAME))
}

/**
 * Resolve the concrete theme for this request: the preference itself, or for
 * "system" the device scheme last reported by the client, defaulting to dark.
 */
export function resolveTheme(request: Request): ThemeChoice {
  const pref = resolveThemePreference(request)
  if (pref !== "system") return pref
  const scheme = readCookie(request, SCHEME_COOKIE)
  return isThemeChoice(scheme) ? scheme : DEFAULT_THEME
}

export function themeCookieHeader(theme: ThemePreference): string {
  // Not HttpOnly: the pre-paint script in root.tsx reads it to resolve the
  // theme before first paint.
  return `${COOKIE_NAME}=${theme}; Path=/; SameSite=Lax; Max-Age=31536000`
}
