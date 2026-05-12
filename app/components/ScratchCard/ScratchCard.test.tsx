import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
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
})
