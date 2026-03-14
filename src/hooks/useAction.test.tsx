import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act, cleanup } from "@testing-library/react"
import { useAction } from "./useAction"

type TestResult = { success: true; value: number } | { error: string }

function TestComponent({ apiUrl }: { apiUrl: string }) {
  const action = useAction<TestResult>(apiUrl)

  return (
    <div>
      <p data-testid="state">{action.state}</p>
      <p data-testid="data">{action.data ? JSON.stringify(action.data) : "none"}</p>
      <action.Form>
        <input name="intent" defaultValue="test" />
        <button type="submit">Submit</button>
      </action.Form>
      <button onClick={() => action.submit({ intent: "programmatic" })}>Programmatic</button>
    </div>
  )
}

// Mock window.location.replace to prevent jsdom navigation errors
const locationReplace = vi.fn()
Object.defineProperty(window, "location", {
  value: { ...window.location, replace: locationReplace, pathname: "/test" },
  writable: true,
})

describe("useAction", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    locationReplace.mockReset()
  })
  afterEach(cleanup)

  it("starts in idle state with no data", () => {
    render(<TestComponent apiUrl="/api/test" />)
    expect(screen.getByTestId("state").textContent).toBe("idle")
    expect(screen.getByTestId("data").textContent).toBe("none")
  })

  it("submits programmatically and updates data on success", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, value: 42 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    render(<TestComponent apiUrl="/api/test" />)

    await act(async () => {
      screen.getByText("Programmatic").click()
    })

    expect(fetchMock).toHaveBeenCalledWith("/api/test", expect.objectContaining({ method: "POST" }))
    expect(screen.getByTestId("state").textContent).toBe("idle")
    expect(screen.getByTestId("data").textContent).toContain('"success":true')
    expect(screen.getByTestId("data").textContent).toContain('"value":42')
  })

  it("handles error responses by setting data with error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Something went wrong" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    )

    render(<TestComponent apiUrl="/api/test" />)

    await act(async () => {
      screen.getByText("Programmatic").click()
    })

    expect(screen.getByTestId("data").textContent).toContain("Something went wrong")
    expect(screen.getByTestId("state").textContent).toBe("idle")
  })

  it("handles network errors gracefully", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"))

    render(<TestComponent apiUrl="/api/test" />)

    await act(async () => {
      screen.getByText("Programmatic").click()
    })

    expect(screen.getByTestId("data").textContent).toContain("Failed to fetch")
    expect(screen.getByTestId("state").textContent).toBe("idle")
  })

  it("submits via Form component", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, value: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    render(<TestComponent apiUrl="/api/form-test" />)

    await act(async () => {
      screen.getByText("Submit").click()
    })

    expect(fetchMock).toHaveBeenCalledWith("/api/form-test", expect.objectContaining({ method: "POST" }))
    expect(screen.getByTestId("data").textContent).toContain('"success":true')
  })
})
