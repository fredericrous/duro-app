import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Owns the transient "Copied!" feedback for copy-to-clipboard buttons: `copied`
 * flips on for `resetAfterMs` (default 2s), the timer restarts on repeat
 * copies, and it's cleared on unmount.
 */
export function useCopyFeedback(resetAfterMs = 2000) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  /** Show the feedback and schedule its reset. */
  const showCopied = useCallback(() => {
    setCopied(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), resetAfterMs)
  }, [resetAfterMs])

  /** Clear the feedback immediately (e.g. when a dialog closes). */
  const resetCopied = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setCopied(false)
  }, [])

  /**
   * Fire-and-forget copy: writes to the clipboard and shows the feedback
   * immediately. Callers that need to await or handle clipboard failures
   * should run their own `writeText` and call `showCopied`/`resetCopied`.
   */
  const copy = useCallback(
    (text: string) => {
      void navigator.clipboard.writeText(text)
      showCopied()
    },
    [showCopied],
  )

  return { copied, copy, showCopied, resetCopied }
}
