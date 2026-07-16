import { useEffect, useState } from "react"

/**
 * Tracks the user's `prefers-reduced-motion` setting.
 *
 * SSR-safe: returns `false` on the server and on the first client paint, then
 * syncs to the media query after mount and stays live to changes. Motion is a
 * progressive enhancement here — never load-bearing — so defaulting to "not
 * reduced" until we can read the real setting is fine.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const sync = () => setReduced(mq.matches)
    sync()
    mq.addEventListener("change", sync)
    return () => mq.removeEventListener("change", sync)
  }, [])

  return reduced
}
