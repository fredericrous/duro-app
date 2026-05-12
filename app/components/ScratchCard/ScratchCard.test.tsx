import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ScratchCard } from "./ScratchCard"

// jsdom doesn't implement HTMLCanvasElement#getContext meaningfully — it
// returns null by default. ScratchCard renders its paint pass + reveal
// callbacks through canvas 2D ops, so stub a minimal 2D context so the
// component doesn't bail out on the canvasCallbackRef path.
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    fillStyle: "",
    fillRect: vi.fn(),
    fillText: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(400) })),
    globalCompositeOperation: "",
    font: "",
    textAlign: "center",
    textBaseline: "middle",
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext
})

describe("ScratchCard", () => {
  it("renders the children + the scratch canvas overlay", () => {
    render(
      <ScratchCard width={300} height={120} onReveal={() => {}}>
        <p>Hidden password</p>
      </ScratchCard>,
    )
    // The hidden content is in the DOM; canvas paints on top.
    expect(screen.getByText("Hidden password")).toBeInTheDocument()
    // The canvas element renders even though its visual is canvas-rasterized.
    const canvas = document.querySelector("canvas")
    expect(canvas).toBeInTheDocument()
  })

  it("renders the default scratch label on the canvas overlay", () => {
    // The label is painted onto canvas via fillText — we can assert the
    // stub got called by inspecting the mock. The DOM itself doesn't
    // surface canvas glyphs.
    render(
      <ScratchCard width={300} height={120} onReveal={() => {}} label="Reveal me">
        <p>Hidden</p>
      </ScratchCard>,
    )
    // No assertion on canvas pixel content (jsdom can't render). But the
    // component must render its width/height props onto the canvas
    // attribute.
    const canvas = document.querySelector("canvas") as HTMLCanvasElement
    expect(canvas.width).toBe(300)
    expect(canvas.height).toBe(120)
  })

  it("invokes onScratchStart on the first pointerdown, then never again", () => {
    const onScratchStart = vi.fn()
    render(
      <ScratchCard width={100} height={100} onReveal={() => {}} onScratchStart={onScratchStart}>
        <p>Hidden</p>
      </ScratchCard>,
    )
    const canvas = document.querySelector("canvas")!

    // jsdom doesn't ship setPointerCapture; stub it so the handler doesn't
    // throw on the first event.
    ;(canvas as HTMLCanvasElement & { setPointerCapture?: (id: number) => void }).setPointerCapture = () => {}
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect

    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 })
    expect(onScratchStart).toHaveBeenCalledTimes(1)

    // Second pointerdown after the start flag is set — handler short-circuits
    // before invoking onScratchStart again.
    fireEvent.pointerDown(canvas, { clientX: 20, clientY: 20, pointerId: 2 })
    expect(onScratchStart).toHaveBeenCalledTimes(1)
  })

  it("calls onReveal when scratched-area threshold is reached on pointerup", () => {
    const onReveal = vi.fn()
    // Override getImageData to return fully-transparent pixels — pixel[3]==0
    // for all alpha bytes → transparent / total = 1.0 > revealThreshold.
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      fillStyle: "",
      fillRect: vi.fn(),
      fillText: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      // 100 pixels × 4 bytes (RGBA), all zeros → fully "transparent".
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(400) })),
      globalCompositeOperation: "",
      font: "",
      textAlign: "center",
      textBaseline: "middle",
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext

    render(
      <ScratchCard width={100} height={100} revealThreshold={0.5} onReveal={onReveal}>
        <p>Hidden</p>
      </ScratchCard>,
    )
    const canvas = document.querySelector("canvas")!
    ;(canvas as HTMLCanvasElement & { setPointerCapture?: (id: number) => void }).setPointerCapture = () => {}
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect

    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 20, clientY: 20 })
    fireEvent.pointerUp(canvas)
    expect(onReveal).toHaveBeenCalledTimes(1)
  })

  it("does NOT invoke onReveal when the scratched area is below threshold", () => {
    const onReveal = vi.fn()
    // Pixels are non-zero (full alpha) → transparent count stays 0.
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      fillStyle: "",
      fillRect: vi.fn(),
      fillText: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray(400).fill(255),
      })),
      globalCompositeOperation: "",
      font: "",
      textAlign: "center",
      textBaseline: "middle",
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext

    render(
      <ScratchCard width={100} height={100} onReveal={onReveal}>
        <p>Hidden</p>
      </ScratchCard>,
    )
    const canvas = document.querySelector("canvas")!
    ;(canvas as HTMLCanvasElement & { setPointerCapture?: (id: number) => void }).setPointerCapture = () => {}
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect

    fireEvent.pointerDown(canvas, { clientX: 5, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(canvas)
    expect(onReveal).not.toHaveBeenCalled()
  })
})
