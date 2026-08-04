import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Owns the transient feedback for copy-to-clipboard buttons: `copied` flips on
 * for `resetAfterMs` (default 2s), `copyFailed` for `failResetAfterMs` (default
 * 5s, longer because it asks the user to copy manually). The two are mutually
 * exclusive, the timer restarts on repeat copies, and it's cleared on unmount.
 */
export function useCopyFeedback(resetAfterMs = 2000, failResetAfterMs = 5000) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  const flash = useCallback((outcome: "copied" | "failed", ms: number) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setCopied(outcome === "copied")
    setCopyFailed(outcome === "failed")
    timerRef.current = setTimeout(() => {
      setCopied(false)
      setCopyFailed(false)
    }, ms)
  }, [])

  /** Show the success feedback and schedule its reset. */
  const showCopied = useCallback(() => flash("copied", resetAfterMs), [flash, resetAfterMs])

  /** Clear the feedback immediately (e.g. when a dialog closes). */
  const resetCopied = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setCopied(false)
    setCopyFailed(false)
  }, [])

  /**
   * Copy `text`, then report what actually happened. The Clipboard API is
   * absent in insecure contexts and rejects when permission is denied — both
   * must surface as `copyFailed` so the UI can offer a manual fallback rather
   * than claim a copy that never happened.
   */
  const copy = useCallback(
    (text: string) => {
      const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined
      if (!clipboard?.writeText) {
        flash("failed", failResetAfterMs)
        return
      }
      clipboard.writeText(text).then(
        () => flash("copied", resetAfterMs),
        () => flash("failed", failResetAfterMs),
      )
    },
    [flash, resetAfterMs, failResetAfterMs],
  )

  return { copied, copyFailed, copy, showCopied, resetCopied }
}
