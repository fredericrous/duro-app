import { useState, useCallback, type FormEvent, type FC, type FormHTMLAttributes } from "react"

type ActionState = "idle" | "submitting"

export interface UseActionReturn<TResult> {
  data: TResult | undefined
  state: ActionState
  submit: (data: FormData | Record<string, string>) => Promise<void>
  Form: FC<FormHTMLAttributes<HTMLFormElement>>
}

/**
 * Framework-agnostic action hook. Submits FormData to an API endpoint via fetch.
 * Revalidates by replacing the current URL (triggers loaders in both React Router and Expo Router).
 */
export function useAction<TResult>(apiUrl: string): UseActionReturn<TResult> {
  const [data, setData] = useState<TResult>()
  const [state, setState] = useState<ActionState>("idle")

  const submit = useCallback(
    async (payload: FormData | Record<string, string>) => {
      setState("submitting")
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
          setData(undefined)
          window.location.replace(window.location.pathname)
          return
        }

        try {
          const json = (await res.json()) as TResult
          setData(json)
        } catch {
          if (!res.ok) {
            setData({ error: `HTTP ${res.status}` } as TResult)
          }
        }

        // Revalidate: replace current URL to re-run loaders
        window.location.replace(window.location.pathname)
      } catch (e) {
        setData({ error: e instanceof Error ? e.message : "Network error" } as TResult)
      } finally {
        setState("idle")
      }
    },
    [apiUrl],
  )

  const Form: FC<FormHTMLAttributes<HTMLFormElement>> = useCallback(
    ({ children, onSubmit, ...props }) => {
      const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        onSubmit?.(e as any)
        submit(new FormData(e.currentTarget) as any)
      }
      return (
        <form {...props} onSubmit={handleSubmit}>
          {children}
        </form>
      )
    },
    [submit],
  )

  return { data, state, submit, Form }
}
