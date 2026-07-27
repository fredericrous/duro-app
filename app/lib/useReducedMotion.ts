import { useMediaQuery } from "~/hooks/useMediaQuery"

/**
 * Tracks the user's `prefers-reduced-motion` setting.
 *
 * Thin wrapper over `useMediaQuery` (useSyncExternalStore, SSR-safe): returns
 * `false` on the server and stays live to changes on the client. Motion is a
 * progressive enhancement here — never load-bearing — so defaulting to "not
 * reduced" until we can read the real setting is fine.
 */
export function useReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)")
}
