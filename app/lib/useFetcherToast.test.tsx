import { describe, it, expect } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import type { Fetcher } from "react-router"
import { ToastProvider } from "@duro-app/ui"
import { useFetcherToast } from "./useFetcherToast"

function Harness({ fetcher }: { fetcher: Fetcher }) {
  useFetcherToast(fetcher)
  return null
}

const fetcherOf = (state: string, data?: unknown) => ({ state, data }) as unknown as Fetcher

describe("useFetcherToast", () => {
  it("toasts once when a submission settles, and dedupes on revalidation", async () => {
    // idle mount with no data → nothing (also proves it never toasts loader data)
    const { rerender } = render(
      <ToastProvider>
        <Harness fetcher={fetcherOf("idle")} />
      </ToastProvider>,
    )
    expect(screen.queryByRole("status")).not.toBeInTheDocument()

    // submitting → still nothing
    rerender(
      <ToastProvider>
        <Harness fetcher={fetcherOf("submitting")} />
      </ToastProvider>,
    )
    expect(screen.queryByRole("status")).not.toBeInTheDocument()

    // settled with a result → exactly one toast
    const result = { success: true as const, message: "Saved" }
    rerender(
      <ToastProvider>
        <Harness fetcher={fetcherOf("idle", result)} />
      </ToastProvider>,
    )
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"))

    // a re-render with the SAME data reference (e.g. revalidation) must not re-toast
    rerender(
      <ToastProvider>
        <Harness fetcher={fetcherOf("idle", result)} />
      </ToastProvider>,
    )
    expect(screen.getAllByRole("status")).toHaveLength(1)
  })

  it("ignores data that never passed through a busy state (loader-style)", async () => {
    render(
      <ToastProvider>
        <Harness fetcher={fetcherOf("idle", { success: true, message: "Loaded" })} />
      </ToastProvider>,
    )
    // Give any effects a tick, then assert nothing toasted.
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })
})
