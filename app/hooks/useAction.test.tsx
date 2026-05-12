import { describe, expect, it, vi, beforeEach } from "vitest"
import { renderHook, act, render, fireEvent, screen, waitFor } from "@testing-library/react"
import { http, HttpResponse, server } from "~/test/msw-server"
import { useAction } from "./useAction"

// The fetch endpoint we'll point the hook at — MSW intercepts based on
// the absolute origin, so use jsdom's default `http://localhost`.
const API = "http://localhost/api/test"

describe("useAction — submit", () => {
  it("posts FormData built from a plain-object payload and exposes the JSON result", async () => {
    let receivedBody: FormData | null = null
    server.use(
      http.post(API, async ({ request }) => {
        receivedBody = await request.formData()
        return HttpResponse.json({ ok: true, echo: receivedBody.get("name") })
      }),
    )

    const { result } = renderHook(() => useAction<{ ok: boolean; echo: string }>(API))
    expect(result.current.state).toBe("idle")
    expect(result.current.data).toBeUndefined()

    await act(async () => {
      await result.current.submit({ name: "alice" })
    })

    expect(result.current.state).toBe("idle")
    expect(result.current.data).toEqual({ ok: true, echo: "alice" })
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
    expect(result.current.data).toEqual({ ok: true })
  })

  it("flips state to 'submitting' for the duration of the request", async () => {
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
    // While the server hasn't responded, state should be "submitting".
    await waitFor(() => expect(result.current.state).toBe("submitting"))
    resolveServer()
    await act(async () => {
      await submitDone!
    })
    expect(result.current.state).toBe("idle")
  })

  it("records an HTTP error shape when the response is non-2xx and not JSON", async () => {
    server.use(http.post(API, () => new HttpResponse("plain-text-error", { status: 500 })))

    const { result } = renderHook(() => useAction<{ error?: string }>(API))
    await act(async () => {
      await result.current.submit({})
    })
    expect(result.current.data).toEqual({ error: "HTTP 500" })
    expect(result.current.state).toBe("idle")
  })

  it("captures network errors into the data shape", async () => {
    // MSW's error() returns a real ECONNREFUSED-style failure to the fetch
    // call, which the hook catches into `{ error: ... }`.
    server.use(http.post(API, () => HttpResponse.error()))

    const { result } = renderHook(() => useAction<{ error?: string }>(API))
    await act(async () => {
      await result.current.submit({})
    })
    expect(result.current.data?.error).toBeTruthy()
    expect(result.current.state).toBe("idle")
  })

  it("calls onSuccess after a 2xx response", async () => {
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

    const { result } = renderHook(() => useAction<{ error?: string }>(API, { onSuccess }))
    await act(async () => {
      await result.current.submit({})
    })
    expect(onSuccess).not.toHaveBeenCalled()
    expect(result.current.data).toEqual({ error: "bad" })
  })
})

describe("useAction — Form component", () => {
  it("renders a real <form> that submits via FormData on user submit", async () => {
    let receivedName: string | null = null
    server.use(
      http.post(API, async ({ request }) => {
        const fd = await request.formData()
        receivedName = fd.get("name") as string
        return HttpResponse.json({ ok: true })
      }),
    )

    function Component() {
      const { Form } = useAction<{ ok: boolean }>(API)
      return (
        <Form>
          <input name="name" defaultValue="bob" data-testid="name" />
          <button type="submit">Send</button>
        </Form>
      )
    }
    render(<Component />)

    fireEvent.submit(screen.getByRole("button", { name: "Send" }).closest("form")!)

    await waitFor(() => expect(receivedName).toBe("bob"))
  })

  it("invokes the caller's onSubmit before sending the request", async () => {
    server.use(http.post(API, () => HttpResponse.json({ ok: true })))
    const callerOnSubmit = vi.fn()

    function Component() {
      const { Form } = useAction<{ ok: boolean }>(API)
      return (
        <Form onSubmit={callerOnSubmit}>
          <input name="x" defaultValue="y" />
          <button type="submit">Send</button>
        </Form>
      )
    }
    render(<Component />)
    fireEvent.submit(screen.getByRole("button").closest("form")!)
    await waitFor(() => expect(callerOnSubmit).toHaveBeenCalled())
  })
})
