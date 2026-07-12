import { useEffect, useRef } from "react"
import type { Fetcher } from "react-router"
import { useToast, type ToastOptions } from "@duro-app/ui"

/**
 * Canonical mutation result shape across the app's route actions.
 * ({ success: true, message? } | { error }); see handleAdminUsersMutation et al.
 */
export type MutationResult = { success: true; message?: string } | { error: string }

interface FetcherToastOptions {
  /** Success toast copy when the result carries no `message`. */
  successMessage?: string
  /**
   * Full control: map the settled fetcher data to a toast, or return null to
   * stay silent. Overrides the default success/error mapping — use this when
   * the message needs interpolation, or when the action returns a non-canonical
   * shape. Receives the raw data; narrow it at the call site.
   */
  render?: (data: unknown) => ToastOptions | null
}

function isResult(data: unknown): data is MutationResult {
  return typeof data === "object" && data !== null && ("success" in data || "error" in data)
}

/**
 * Show a toast for the RESULT of a fetcher submission — once, when it settles.
 *
 * Contract (avoids the classic double-toast on revalidation):
 *  - fires only on the transition submitting/loading → idle,
 *  - only when `fetcher.data` is a mutation result,
 *  - dedupes on the data object's identity (a preserved/revalidated response
 *    with the same reference never re-toasts),
 *  - never fires for initial/loader data (data is undefined until the first
 *    submission, and we require a prior non-idle state).
 */
export function useFetcherToast(fetcher: Fetcher, opts: FetcherToastOptions = {}): void {
  const { toast } = useToast()
  const optsRef = useRef(opts)
  useEffect(() => {
    optsRef.current = opts
  })
  const prevState = useRef(fetcher.state)
  const handled = useRef<unknown>(null)

  useEffect(() => {
    const wasBusy = prevState.current !== "idle"
    prevState.current = fetcher.state
    if (fetcher.state !== "idle" || !wasBusy) return

    const data = fetcher.data
    if (data == null || handled.current === data) return
    handled.current = data

    const o = optsRef.current
    let built: ToastOptions | null = null
    if (o.render) {
      built = o.render(data)
    } else if (isResult(data)) {
      built =
        "error" in data
          ? { variant: "error", message: data.error }
          : { variant: "success", message: data.message ?? o.successMessage ?? "" }
    }
    if (built && built.message) toast(built)
  }, [fetcher.state, fetcher.data, toast])
}
