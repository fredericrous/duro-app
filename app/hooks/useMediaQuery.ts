import { useCallback, useSyncExternalStore } from "react"

export function useMediaQuery(query: string, serverDefault = false): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const mql = window.matchMedia(query)
      mql.addEventListener("change", cb)
      return () => mql.removeEventListener("change", cb)
    },
    [query],
  )

  const getSnapshot = () => window.matchMedia(query).matches

  const getServerSnapshot = () => serverDefault

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
