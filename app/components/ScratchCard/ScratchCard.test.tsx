import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ScratchCard } from "./ScratchCard"

// jsdom doesn't implement HTMLCanvasElement#getContext meaningfully.
// ScratchCard does real canvas work — paintCanvas() fills + fillText,
// scratch() uses globalCompositeOperation="destination-out" + arc + fill
// to erase circular regions, checkReveal() reads back the alpha channel
// via getImageData to decide whether to call onReveal.
//
// We mock the 2D context with a STATEFUL implementation that tracks the
// alpha channel. Scratching marks pixels alpha=0 inside the destination-
// out arc; getImageData reads the current buffer. This way the test
// actually proves the scratch-loop produces transparency rather than
// hard-wiring the threshold check.

interface MockCtx {
  fillStyle: string
  globalCompositeOperation: string
  font: string
  textAlign: string
  textBaseline: string
  fillRect: ReturnType<typeof vi.fn>
  fillText: ReturnType<typeof vi.fn>
  beginPath: ReturnType<typeof vi.fn>
  arc: (x: number, y: number, r: number, ...rest: unknown[]) => void
  fill: () => void
  getImageData: () => { data: Uint8ClampedArray }
  /** Test inspection: how many distinct destination-out fill regions ran. */
  scratchedRegions: Array<{ x: number; y: number; r: number }>
}

function makeStatefulCanvasMock(width: number, height: number): MockCtx {
  // RGBA pixel buffer. Start opaque (alpha = 255 everywhere).
  const alphaBuf = new Uint8ClampedArray(width * height * 4)
  for (let i = 3; i < alphaBuf.length; i += 4) alphaBuf[i] = 255

  let pendingArc: { x: number; y: number; r: number } | null = null
  const scratchedRegions: MockCtx["scratchedRegions"] = []
  const ctx: MockCtx = {
    fillStyle: "",
    globalCompositeOperation: "",
    font: "",
    textAlign: "center",
    textBaseline: "middle",
    fillRect: vi.fn(),
    fillText: vi.fn(),
    beginPath: vi.fn(() => {
      pendingArc = null
    }),
    arc(x, y, r) {
      pendingArc = { x, y, r }
    },
    fill() {
      if (pendingArc && ctx.globalCompositeOperation === "destination-out") {
        scratchedRegions.push(pendingArc)
        const { x, y, r } = pendingArc
        // Mark every pixel within the circle as alpha=0.
        for (let py = Math.max(0, Math.floor(y - r)); py < Math.min(height, Math.ceil(y + r)); py++) {
          for (let px = Math.max(0, Math.floor(x - r)); px < Math.min(width, Math.ceil(x + r)); px++) {
            const dx = px - x
            const dy = py - y
            if (dx * dx + dy * dy <= r * r) {
              alphaBuf[(py * width + px) * 4 + 3] = 0
            }
          }
        }
      }
      pendingArc = null
    },
    getImageData() {
      return { data: alphaBuf }
    },
    scratchedRegions,
  }
  return ctx
}

let currentCtx: MockCtx
let originalGetContext: typeof HTMLCanvasElement.prototype.getContext

beforeEach(() => {
  // Default ctx — width/height set during render; per-test render overrides
  // when it needs different dimensions.
  currentCtx = makeStatefulCanvasMock(100, 100)
  originalGetContext = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => currentCtx,
  ) as unknown as typeof HTMLCanvasElement.prototype.getContext
})

afterEach(() => {
  // Always restore the original prototype method to avoid leaking the mock
  // across tests in other files.
  HTMLCanvasElement.prototype.getContext = originalGetContext
})

/** Stub jsdom-missing methods on the canvas element for pointer events. */
function prepareCanvas(canvas: HTMLCanvasElement, size: number) {
  ;(canvas as HTMLCanvasElement & { setPointerCapture?: (id: number) => void }).setPointerCapture = () => {}
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: size, height: size }) as DOMRect
}

describe("ScratchCard", () => {
  it("renders the children + the scratch canvas overlay", () => {
    render(
      <ScratchCard width={300} height={120} onReveal={() => {}}>
        <p>Hidden password</p>
      </ScratchCard>,
    )
    expect(screen.getByText("Hidden password")).toBeInTheDocument()
    expect(document.querySelector("canvas")).toBeInTheDocument()
  })

  it("paints the canvas at the requested width/height on mount", () => {
    render(
      <ScratchCard width={300} height={120} onReveal={() => {}}>
        <p>Hidden</p>
      </ScratchCard>,
    )
    const canvas = document.querySelector("canvas") as HTMLCanvasElement
    expect(canvas.width).toBe(300)
    expect(canvas.height).toBe(120)
    // paintCanvas fills the background + writes the label glyph; both
    // happen as side-effects on mount.
    expect(currentCtx.fillRect).toHaveBeenCalled()
    expect(currentCtx.fillText).toHaveBeenCalled()
  })

  it("invokes onScratchStart on the first pointerdown, then never again", () => {
    const onScratchStart = vi.fn()
    render(
      <ScratchCard width={100} height={100} onReveal={() => {}} onScratchStart={onScratchStart}>
        <p>Hidden</p>
      </ScratchCard>,
    )
    const canvas = document.querySelector("canvas") as HTMLCanvasElement
    prepareCanvas(canvas, 100)

    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 })
    expect(onScratchStart).toHaveBeenCalledTimes(1)

    fireEvent.pointerDown(canvas, { clientX: 20, clientY: 20, pointerId: 2 })
    expect(onScratchStart).toHaveBeenCalledTimes(1)
  })

  it("each pointerdown/move emits a destination-out fill into the canvas alpha buffer", () => {
    render(
      <ScratchCard width={100} height={100} onReveal={() => {}}>
        <p>Hidden</p>
      </ScratchCard>,
    )
    const canvas = document.querySelector("canvas") as HTMLCanvasElement
    prepareCanvas(canvas, 100)

    // First pointer down → one scratch region; pointermove adds another.
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 })
    expect(currentCtx.scratchedRegions).toHaveLength(1)
    fireEvent.pointerMove(canvas, { clientX: 30, clientY: 30 })
    expect(currentCtx.scratchedRegions).toHaveLength(2)
    fireEvent.pointerUp(canvas)
  })

  it("calls onReveal when enough of the canvas has actually been scratched (~70% > 0.5 threshold)", () => {
    const onReveal = vi.fn()
    render(
      <ScratchCard width={100} height={100} revealThreshold={0.5} onReveal={onReveal}>
        <p>Hidden</p>
      </ScratchCard>,
    )
    const canvas = document.querySelector("canvas") as HTMLCanvasElement
    prepareCanvas(canvas, 100)

    // Sweep a wide path covering most of the canvas. Each scratch() draws a
    // radius-20 disk → ~1256 px² cleared per stroke. We need >5000 px²
    // (50% of 10000) cleared to trip the threshold.
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 })
    for (let x = 10; x <= 90; x += 10) {
      for (let y = 10; y <= 90; y += 10) {
        fireEvent.pointerMove(canvas, { clientX: x, clientY: y })
      }
    }
    fireEvent.pointerUp(canvas)
    expect(currentCtx.scratchedRegions.length).toBeGreaterThan(50)
    expect(onReveal).toHaveBeenCalledTimes(1)
  })

  it("does NOT invoke onReveal when only a tiny patch was scratched (well below threshold)", () => {
    const onReveal = vi.fn()
    render(
      <ScratchCard width={100} height={100} revealThreshold={0.5} onReveal={onReveal}>
        <p>Hidden</p>
      </ScratchCard>,
    )
    const canvas = document.querySelector("canvas") as HTMLCanvasElement
    prepareCanvas(canvas, 100)

    // One pointerdown clears ~1256 px² (radius 20 disk) ≈ 12.5% of 10000 —
    // well under the 50% threshold.
    fireEvent.pointerDown(canvas, { clientX: 50, clientY: 50, pointerId: 1 })
    fireEvent.pointerUp(canvas)
    expect(onReveal).not.toHaveBeenCalled()
  })
})
