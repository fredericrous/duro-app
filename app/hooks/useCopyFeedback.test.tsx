import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"
import { useCopyFeedback } from "./useCopyFeedback"

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
}

beforeEach(() => {
  stubClipboard(vi.fn().mockResolvedValue(undefined))
})

afterEach(() => {
  vi.useRealTimers()
})

describe("useCopyFeedback", () => {
  it("reports success once the clipboard write resolves", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard(writeText)
    const { result } = renderHook(() => useCopyFeedback())

    act(() => result.current.copy("s3cret"))

    await waitFor(() => expect(result.current.copied).toBe(true))
    expect(result.current.copyFailed).toBe(false)
    expect(writeText).toHaveBeenCalledWith("s3cret")
  })

  it("reports failure — not success — when the write is rejected", async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error("denied")))
    const { result } = renderHook(() => useCopyFeedback())

    act(() => result.current.copy("s3cret"))

    await waitFor(() => expect(result.current.copyFailed).toBe(true))
    expect(result.current.copied).toBe(false)
  })

  it("reports failure when there is no Clipboard API at all", async () => {
    // Insecure contexts (plain http) expose no navigator.clipboard. Claiming a
    // copy there would leave the user with nothing on the clipboard and no clue.
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true })
    const { result } = renderHook(() => useCopyFeedback())

    expect(() => act(() => result.current.copy("s3cret"))).not.toThrow()

    await waitFor(() => expect(result.current.copyFailed).toBe(true))
    expect(result.current.copied).toBe(false)
  })

  it("clears the feedback after its timeout", async () => {
    // Fake timers from the start (the reset timer is scheduled inside `copy`),
    // with shouldAdvanceTime so the clipboard promise can still settle.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { result } = renderHook(() => useCopyFeedback(2000))

    act(() => result.current.copy("s3cret"))
    await waitFor(() => expect(result.current.copied).toBe(true))

    act(() => vi.advanceTimersByTime(2000))

    expect(result.current.copied).toBe(false)
    expect(result.current.copyFailed).toBe(false)
  })

  it("resetCopied clears both flags immediately", async () => {
    const { result } = renderHook(() => useCopyFeedback())

    act(() => result.current.showCopied())
    expect(result.current.copied).toBe(true)

    act(() => result.current.resetCopied())
    expect(result.current.copied).toBe(false)
    expect(result.current.copyFailed).toBe(false)
  })
})
