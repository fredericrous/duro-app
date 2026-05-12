import { useDeferredValue } from "react"
import { useSearchParams } from "react-router"

/**
 * URL-synced search + chip-selection state, shared between /home and /catalog.
 *
 * - `q` holds the free-text query.
 * - `chipParam` ("cat" on home, "state" on catalog) holds the multi-select chip values.
 *
 * Returns:
 * - `query`           — current input value (updates synchronously)
 * - `deferredQuery`   — query lagged via React's useDeferredValue so typing
 *                       stays responsive while the filter recomputes
 * - `selected`        — current chip values from the URL
 * - `setQuery`        — write `q` to the URL (replaceState, no history entry)
 * - `setSelected`     — write chip values to the URL (replaceState)
 *
 * No useEffect — the URL is the source of truth and setters write directly.
 */
export function useAppSearchParams(chipParam: "cat" | "state") {
  const [searchParams, setSearchParams] = useSearchParams()
  const query = searchParams.get("q") ?? ""
  const selected = searchParams.getAll(chipParam)
  const deferredQuery = useDeferredValue(query)

  const setQuery = (next: string) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev)
        if (next) params.set("q", next)
        else params.delete("q")
        return params
      },
      { replace: true },
    )
  }

  const setSelected = (values: string[]) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev)
        params.delete(chipParam)
        for (const v of values) params.append(chipParam, v)
        return params
      },
      { replace: true },
    )
  }

  const clearAll = () => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev)
        params.delete("q")
        params.delete(chipParam)
        return params
      },
      { replace: true },
    )
  }

  return { query, deferredQuery, selected, setQuery, setSelected, clearAll }
}
