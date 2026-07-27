import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"

/**
 * Submission lifecycle as a discriminated union — success data and failure
 * errors live in their own variants, so `data` can never be an error smuggled
 * into `TResult` and stale data can't survive a failed submission.
 */
export type ActionStatus<TResult> =
  | { _tag: "Idle" }
  | { _tag: "Submitting" }
  | { _tag: "Success"; data: TResult }
  | { _tag: "Failure"; error: string }

export interface UseActionReturn<TResult> {
  status: ActionStatus<TResult>
  submit: (data: FormData | Record<string, string>) => Promise<void>
  /** Spread onto a <form> to submit it through this action on user submit. */
  getFormProps: () => { onSubmit: (e: FormEvent<HTMLFormElement>) => void }
}

/**
 * Framework-agnostic action hook. Submits FormData to a JSON API endpoint via
 * fetch; the settled result lands in `status` — the component decides what to
 * render. Server-initiated redirects are followed automatically. Optional
 * `onSuccess` fires after a 2xx non-redirect JSON response (use to refetch
 * data); options are read through a ref, so an inline options object never
 * changes `submit`'s identity.
 */
export function useAction<TResult>(apiUrl: string, options?: { onSuccess?: () => void }): UseActionReturn<TResult> {
  const [status, setStatus] = useState<ActionStatus<TResult>>({ _tag: "Idle" })

  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })

  const submit = useCallback(
    async (payload: FormData | Record<string, string>) => {
      setStatus({ _tag: "Submitting" })
      try {
        const body =
          payload instanceof FormData
            ? payload
            : (() => {
                const fd = new FormData()
                Object.entries(payload).forEach(([k, v]) => fd.append(k, v))
                return fd
              })()

        const res = await fetch(apiUrl, { method: "POST", body })

        if (res.redirected) {
          setStatus({ _tag: "Idle" })
          window.location.replace(res.url)
          return
        }

        let json: unknown
        try {
          json = await res.json()
        } catch {
          // A body that isn't JSON must never keep a previous submission's
          // data on screen — settle explicitly instead of falling through.
          setStatus(
            res.ok
              ? { _tag: "Failure", error: `Malformed response (HTTP ${res.status})` }
              : { _tag: "Failure", error: `HTTP ${res.status}` },
          )
          return
        }

        if (!res.ok) {
          const message =
            typeof json === "object" && json !== null && "error" in json && typeof json.error === "string"
              ? json.error
              : `HTTP ${res.status}`
          setStatus({ _tag: "Failure", error: message })
          return
        }

        setStatus({ _tag: "Success", data: json as TResult })
        optionsRef.current?.onSuccess?.()
      } catch (e) {
        setStatus({ _tag: "Failure", error: e instanceof Error ? e.message : "Network error" })
      }
    },
    [apiUrl],
  )

  const getFormProps = useCallback(
    () => ({
      onSubmit: (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        void submit(new FormData(e.currentTarget))
      },
    }),
    [submit],
  )

  return { status, submit, getFormProps }
}
