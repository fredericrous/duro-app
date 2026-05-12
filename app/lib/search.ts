import { matchSorter } from "match-sorter"

/**
 * Fuzzy search wrapper around `match-sorter`. Centralised so the rest of the
 * app imports `filterByQuery` rather than the underlying library — keeps the
 * swap path open if we outgrow match-sorter without churning callers.
 *
 * Empty / whitespace-only queries return a defensive copy of the input so
 * callers can spread/sort without mutating loader data.
 */
export function filterByQuery<T>(
  items: readonly T[],
  query: string,
  keys: ReadonlyArray<keyof T | ((item: T) => string)>,
): T[] {
  if (!query.trim()) return [...items]
  return matchSorter(items as T[], query, {
    keys: keys as ReadonlyArray<string | ((item: T) => string)>,
  })
}
