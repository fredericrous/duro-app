import { useDeferredValue, useState } from "react"
import { useSearchParams } from "react-router"
import type { ShouldRevalidateFunctionArgs } from "react-router"

/** The params /home and /catalog filter on entirely in the browser. */
const CLIENT_FILTER_PARAMS = ["q", "cat", "state"] as const

/**
 * Whether two URLs differ by anything other than the client-side filter params.
 */
function differsBeyondFilters(a: URL, b: URL): boolean {
  const strip = (u: URL) => {
    const params = new URLSearchParams(u.search)
    for (const p of CLIENT_FILTER_PARAMS) params.delete(p)
    params.sort()
    return params.toString()
  }
  return strip(a) !== strip(b)
}

/**
 * `shouldRevalidate` for the routes that use this hook.
 *
 * Typing writes `q` to the URL on every keystroke, and a search-param change is
 * a navigation, so by default React Router re-ran the loader once per character
 * — refetching data the query does not even influence, since `q` and the chips
 * are applied client-side. On a fast link that is invisible; on a slow one every
 * keystroke waited on a round trip.
 *
 * Only the filter params are exempted, and only for plain navigations: anything
 * else about the URL changing, or a revalidation following a mutation, still
 * goes through.
 */
export function shouldRevalidateAppSearch({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs): boolean {
  // Never suppress the refetch that follows a submission — requesting access
  // has to be reflected on the page it was requested from.
  if (formMethod && formMethod.toUpperCase() !== "GET") return defaultShouldRevalidate
  if (currentUrl.pathname !== nextUrl.pathname) return defaultShouldRevalidate
  if (differsBeyondFilters(currentUrl, nextUrl)) return defaultShouldRevalidate
  return false
}

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
 * The input reads from local state, not from the URL. Reading it back from the
 * URL meant every character had to complete a navigation before it appeared,
 * so on a slow connection the field lagged behind the keyboard. The URL is
 * still written on every keystroke and still owns sharing, reload and history;
 * it just no longer sits between the user and their own typing.
 */
export function useAppSearchParams(chipParam: "cat" | "state") {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlQuery = searchParams.get("q") ?? ""
  const selected = searchParams.getAll(chipParam)

  const [query, setQueryState] = useState(urlQuery)
  // Adjusting state during render (React's documented alternative to a sync
  // effect): when `q` changes underneath us — back/forward, a link into the
  // page with a query already on it — the field follows the URL again.
  const [lastUrlQuery, setLastUrlQuery] = useState(urlQuery)
  if (urlQuery !== lastUrlQuery) {
    setLastUrlQuery(urlQuery)
    setQueryState(urlQuery)
  }

  const deferredQuery = useDeferredValue(query)

  const setQuery = (next: string) => {
    setQueryState(next)
    setLastUrlQuery(next)
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
    setQueryState("")
    setLastUrlQuery("")
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
