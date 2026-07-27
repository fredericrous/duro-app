import type { ThemeChoice, ThemePreference } from "~/lib/theme.server"
import { useMediaQuery } from "./useMediaQuery"

/**
 * Resolve the concrete theme on the client. For explicit preferences this is
 * the preference itself; for "system" it follows the OS scheme live (and
 * corrects a stale `__duro_scheme` cookie right after hydration).
 *
 * Hydration-safe: useMediaQuery returns the SSR-resolved value during
 * hydration, then re-syncs to the real matchMedia result — the same
 * before-paint value the root inline script already applied to
 * html[data-theme], so no flash in the common case.
 */
export function useResolvedTheme(ssrTheme: ThemeChoice, preference: ThemePreference): ThemeChoice {
  const prefersLight = useMediaQuery("(prefers-color-scheme: light)", ssrTheme === "light")
  if (preference !== "system") return preference
  return prefersLight ? "light" : "dark"
}
