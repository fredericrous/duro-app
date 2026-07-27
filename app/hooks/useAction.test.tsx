import { describe, expect, it, vi } from "vitest"
import { renderHook, act, render, fireEvent, screen, waitFor } from "@testing-library/react"
import { http, HttpResponse, server } from "~/test/msw-server"
import { useAction } from "./useAction"

// The fetch endpoint we'll point the hook at — MSW intercepts based on
// the absolute origin, so use jsdom's default `http://localhost`.
const API = "http://localhost/api/test"

describe("useAction — submit", () => {
  it("posts FormData built from a plain-object payload and settles on Success with the JSON result", async () => {
    let receivedBody: FormData | null = null
    server.use(
      http.post(API, async ({ request }) => {
        receivedBody = await request.formData()
        return HttpResponse.json({ ok: true, echo: receivedBody.get("name") })
      }),
    )

    const { result } = renderHook(() => useAction<{ ok: boolean; echo: string }>(API))
    expect(result.current.status).toEqual({ _tag: "Idle" })

    await act(async () => {
      await result.current.submit({ name: "alice" })
    })

    expect(result.current.status).toEqual({ _tag: "Success", data: { ok: true, echo: "alice" } })
    expect(receivedBody).not.toBeNull()
  })

  it("forwards a FormData payload as-is (no conversion)", async () => {
    let receivedKeys: string[] = []
    server.use(
      http.post(API, async ({ request }) => {
        const fd = await request.formData()
        receivedKeys = Array.from(fd.keys())
        return HttpResponse.json({ ok: true })
      }),
    )

    const fd = new FormData()
    fd.append("intent", "create")
    fd.append("name", "alice")

    const { result } = renderHook(() => useAction<{ ok: boolean }>(API))
    await act(async () => {
      await result.current.submit(fd)
    })

    expect(receivedKeys).toEqual(["intent", "name"])
    expect(result.current.status).toEqual({ _tag: "Success", data: { ok: true } })
  })

  it("flips status to Submitting for the duration of the request", async () => {
    let resolveServer: () => void = () => {}
    const serverPromise = new Promise<void>((r) => {
      resolveServer = r
    })
    server.use(
      http.post(API, async () => {
        await serverPromise
        return HttpResponse.json({ ok: true })
      }),
    )

    const { result } = renderHook(() => useAction<{ ok: boolean }>(API))

    let submitDone: Promise<void>
    act(() => {
      submitDone = result.current.submit({ x: "y" })
    })
    // While the server hasn't responded, the status should be Submitting.
    await waitFor(() => expect(result.current.status._tag).toBe("Submitting"))
    resolveServer()
    await act(async () => {
      await submitDone!
    })
    expect(result.current.status._tag).toBe("Success")
  })

  it("settles on Failure with an HTTP error when the response is non-2xx and not JSON", async () => {
    server.use(http.post(API, () => new HttpResponse("plain-text-error", { status: 500 })))

    const { result } = renderHook(() => useAction<{ ok: boolean }>(API))
    await act(async () => {
      await result.current.submit({})
    })
    expect(result.current.status).toEqual({ _tag: "Failure", error: "HTTP 500" })
  })

  it("surfaces a non-2xx JSON error body in the Failure variant", async () => {
    server.use(http.post(API, () => HttpResponse.json({ error: "bad" }, { status: 400 })))

    const { result } = renderHook(() => useAction<{ ok: boolean }>(API))
    await act(async () => {
      await result.current.submit({})
    })
    expect(result.current.status).toEqual({ _tag: "Failure", error: "bad" })
  })

  it("captures network errors into the Failure variant", async () => {
    // MSW's error() returns a real ECONNREFUSED-style failure to the fetch
    // call, which the hook catches into a Failure status.
    server.use(http.post(API, () => HttpResponse.error()))

    const { result } = renderHook(() => useAction<{ ok: boolean }>(API))
    await act(async () => {
      await result.current.submit({})
    })
    expect(result.current.status._tag).toBe("Failure")
    expect(result.current.status._tag === "Failure" && result.current.status.error).toBeTruthy()
  })

  it("does NOT keep a previous submission's data when a 2xx response has a non-JSON body", async () => {
    server.use(http.post(API, () => HttpResponse.json({ ok: true })))
    const { result } = renderHook(() => useAction<{ ok: boolean }>(API))
    await act(async () => {
      await result.current.submit({})
    })
    expect(result.current.status).toEqual({ _tag: "Success", data: { ok: true } })

    server.use(http.post(API, () => new HttpResponse("<html>not json</html>", { status: 200 })))
    await act(async () => {
      await result.current.submit({})
    })
    expect(result.current.status).toEqual({ _tag: "Failure", error: "Malformed response (HTTP 200)" })
  })

  it("calls onSuccess after a 2xx JSON response", async () => {
    server.use(http.post(API, () => HttpResponse.json({ ok: true })))
    const onSuccess = vi.fn()

    const { result } = renderHook(() => useAction<{ ok: boolean }>(API, { onSuccess }))
    await act(async () => {
      await result.current.submit({})
    })
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it("does NOT call onSuccess on a non-2xx response", async () => {
    server.use(http.post(API, () => HttpResponse.json({ error: "bad" }, { status: 400 })))
    const onSuccess = vi.fn()

    const { result } = renderHook(() => useAction<{ ok: boolean }>(API, { onSuccess }))
    await act(async () => {
      await result.current.submit({})
    })
    expect(onSuccess).not.toHaveBeenCalled()
    expect(result.current.status).toEqual({ _tag: "Failure", error: "bad" })
  })

  it("keeps submit's identity stable across renders with an inline options object", async () => {
    server.use(http.post(API, () => HttpResponse.json({ ok: true })))
    const onSuccess = vi.fn()

    // A fresh options object every render must not mint a new submit.
    const { result, rerender } = renderHook(() => useAction<{ ok: boolean }>(API, { onSuccess }))
    const firstSubmit = result.current.submit
    rerender()
    expect(result.current.submit).toBe(firstSubmit)

    // The latest onSuccess is still the one invoked (read through a ref).
    await act(async () => {
      await result.current.submit({})
    })
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })
})

describe("useAction — getFormProps", () => {
  it("submits the <form>'s FormData through the action on user submit", async () => {
    let receivedName: string | null = null
    server.use(
      http.post(API, async ({ request }) => {
        const fd = await request.formData()
        receivedName = fd.get("name") as string
        return HttpResponse.json({ ok: true })
      }),
    )

    function Component() {
      const action = useAction<{ ok: boolean }>(API)
      return (
        <form {...action.getFormProps()}>
          <input name="name" defaultValue="bob" data-testid="name" />
          <button type="submit">Send</button>
        </form>
      )
    }
    render(<Component />)

    fireEvent.submit(screen.getByRole("button", { name: "Send" }).closest("form")!)

    await waitFor(() => expect(receivedName).toBe("bob"))
  })
})
