/**
 * Extract a human-readable message from an unknown caught value.
 *
 * Mirrors the snippet that was copy-pasted across the mutation handlers:
 * a real `Error` yields its `message`; a plain object with a `message`
 * property yields that stringified; anything else yields the caller's
 * context-specific fallback.
 */
export function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message
  if (typeof e === "object" && e !== null && "message" in e) {
    return String((e as { message: unknown }).message)
  }
  return fallback
}
