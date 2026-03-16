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
 * Results are stored in `data` — the component decides what to render.
 * Server-initiated redirects are followed automatically.
 * Optional `onSuccess` fires after a 2xx non-redirect response (use to refetch data).
 */
export function useAction<TResult>(
  apiUrl: string,
  options?: { onSuccess?: () => void },
): UseActionReturn<TResult> {
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
          window.location.replace(res.url)
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

        if (res.ok) {
          options?.onSuccess?.()
        }
      } catch (e) {
        setData({ error: e instanceof Error ? e.message : "Network error" } as TResult)
      } finally {
        setState("idle")
      }
    },
    [apiUrl, options],
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
