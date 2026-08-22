import { useRef, useState, useCallback, type ReactNode } from "react"
import styles from "./ScratchCard.module.css"

interface ScratchCardProps {
  width: number
  height: number
  revealThreshold?: number
  /** Mount already uncovered (code visible). Use when the reveal was persisted,
   * so "code visible" stays in sync with a copy button gated on the same state. */
  initialRevealed?: boolean
  onReveal: () => void
  onScratchStart?: () => void
  label?: string
  className?: string
  children: ReactNode
}

/**
 * Paints the foil and its label.
 *
 * The canvas is CSS-stretched to whatever width the layout gives it, so the
 * backing store is sized from the *rendered* box (times devicePixelRatio)
 * rather than the declared width. Painting into a fixed 320px buffer and
 * letting the browser scale it down is what made the label small and soft on a
 * phone. `fillText`'s maxWidth then condenses the label if the card is narrower
 * than the words, instead of letting them run past the edge.
 *
 * Falls back to the declared size before layout has happened (and under jsdom,
 * where getBoundingClientRect reports zeroes).
 */
function paintCanvas(canvas: HTMLCanvasElement, fallbackWidth: number, fallbackHeight: number, label: string) {
  const ctx = canvas.getContext("2d")
  if (!ctx) return
  const rect = canvas.getBoundingClientRect()
  const cssWidth = Math.round(rect.width) || fallbackWidth
  const cssHeight = Math.round(rect.height) || fallbackHeight
  const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1
  canvas.width = Math.round(cssWidth * dpr)
  canvas.height = Math.round(cssHeight * dpr)

  // Canvas can't read CSS variables — resolve the theme at draw time so the
  // scratch foil matches light mode too (root.tsx keeps html[data-theme] live).
  const light = document.documentElement.dataset.theme === "light"
  ctx.fillStyle = light ? "#d4d4d4" : "#333"
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = light ? "#4a4a4a" : "#999"
  ctx.font = `${Math.round(14 * dpr)}px -apple-system, BlinkMacSystemFont, sans-serif`
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(label, canvas.width / 2, canvas.height / 2, canvas.width - 24 * dpr)
}

export function ScratchCard({
  width,
  height,
  revealThreshold = 0.5,
  initialRevealed = false,
  onReveal,
  onScratchStart,
  label = "Scratch or press Enter to reveal",
  className,
  children,
}: ScratchCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isDrawing = useRef(false)
  const revealed = useRef(initialRevealed)
  const scratchStarted = useRef(false)
  const [fadeOut, setFadeOut] = useState(initialRevealed)

  // Single reveal path shared by the mouse scratch-threshold and the keyboard
  // button. Keyboard/screen-reader users can't scratch a canvas, so the button
  // below is their equivalent — without it, onboarding is impossible for them.
  const reveal = useCallback(() => {
    if (revealed.current) return
    if (!scratchStarted.current) {
      scratchStarted.current = true
      onScratchStart?.()
    }
    revealed.current = true
    setFadeOut(true)
    onReveal()
  }, [onReveal, onScratchStart])

  const canvasCallbackRef = useCallback(
    (node: HTMLCanvasElement | null) => {
      canvasRef.current = node
      if (!node) return
      paintCanvas(node, width, height, label)

      // The card is fluid, so its pixel size isn't known at mount and can change
      // (rotation, a resize). Repaint only while the foil is still untouched —
      // repainting mid-scratch would hand the user back the foil they just
      // rubbed off.
      if (typeof ResizeObserver === "undefined") return
      const observer = new ResizeObserver(() => {
        if (scratchStarted.current || revealed.current) return
        paintCanvas(node, width, height, label)
      })
      observer.observe(node)
      return () => observer.disconnect()
    },
    [width, height, label],
  )

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    // Map CSS pixels to the backing store, which is now sized from the rendered
    // box rather than the declared width.
    return {
      x: (e.clientX - rect.left) * (rect.width ? canvas.width / rect.width : 1),
      y: (e.clientY - rect.top) * (rect.height ? canvas.height / rect.height : 1),
    }
  }

  const scratch = (x: number, y: number) => {
    const ctx = canvasRef.current?.getContext("2d")
    if (!ctx) return
    ctx.globalCompositeOperation = "destination-out"
    ctx.beginPath()
    // Radius follows the backing-store scale so the brush feels the same size
    // whatever the card was laid out at.
    ctx.arc(x, y, 20 * ((typeof window !== "undefined" && window.devicePixelRatio) || 1), 0, Math.PI * 2)
    ctx.fill()
  }

  const checkReveal = () => {
    if (revealed.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const pixels = imageData.data
    let transparent = 0
    const total = pixels.length / 4

    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] === 0) transparent++
    }

    if (transparent / total >= revealThreshold) {
      reveal()
    }
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (revealed.current) return
    if (!scratchStarted.current) {
      scratchStarted.current = true
      onScratchStart?.()
    }
    isDrawing.current = true
    canvasRef.current?.setPointerCapture(e.pointerId)
    const pos = getPos(e)
    scratch(pos.x, pos.y)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current || revealed.current) return
    const pos = getPos(e)
    scratch(pos.x, pos.y)
  }

  const handlePointerUp = () => {
    if (!isDrawing.current) return
    isDrawing.current = false
    checkReveal()
  }

  return (
    // The container/cover pair is styled by a CSS module that leans on a
    // descendant combinator (`.container > *:not(.canvas):not(.cover)`) and on
    // pointer-events juggling around the <canvas>; neither is expressible
    // through css.create/html.*.
    // `width` is a maximum, not a fixed size: at 320px this card used to
    // overflow a phone screen once the neighbouring copy button was laid out
    // beside it, which pushed that button under the scratch area — a scratch
    // then landed on "copy" instead. Letting it shrink keeps the two apart.
    // eslint-disable-next-line duro/no-raw-html-element
    <div
      className={`${styles.container}${className ? ` ${className}` : ""}`}
      style={{ width: "100%", maxWidth: width, height }}
    >
      {children}
      {!fadeOut && (
        <>
          {/* Decorative scratch surface: aria-hidden because the button below
              is the accessible control. Keeps mouse pointer scratching. */}
          <canvas
            ref={canvasCallbackRef}
            className={styles.canvas}
            aria-hidden="true"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          />
          {/* Accessible reveal control. `pointer-events: none` lets mouse
              scratches fall through to the canvas, while it stays keyboard-
              focusable and Enter/Space-activatable for keyboard/SR users. */}
          {/* eslint-disable-next-line duro/no-raw-html-element -- see container above */}
          <button type="button" className={styles.cover} aria-label={label} onClick={reveal} />
        </>
      )}
    </div>
  )
}
