import { useRef, useState, useCallback, type ReactNode } from "react"
import styles from "./ScratchCard.module.css"

interface ScratchCardProps {
  width: number
  height: number
  revealThreshold?: number
  onReveal: () => void
  onScratchStart?: () => void
  label?: string
  children: ReactNode
}

function paintCanvas(canvas: HTMLCanvasElement, width: number, height: number, label: string) {
  const ctx = canvas.getContext("2d")
  if (!ctx) return
  canvas.width = width
  canvas.height = height
  ctx.fillStyle = "#333"
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = "#999"
  ctx.font = "14px -apple-system, BlinkMacSystemFont, sans-serif"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(label, width / 2, height / 2)
}

export function ScratchCard({
  width,
  height,
  revealThreshold = 0.5,
  onReveal,
  onScratchStart,
  label = "Scratch to reveal",
  children,
}: ScratchCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isDrawing = useRef(false)
  const revealed = useRef(false)
  const scratchStarted = useRef(false)
  const [fadeOut, setFadeOut] = useState(false)

  const canvasCallbackRef = useCallback(
    (node: HTMLCanvasElement | null) => {
      canvasRef.current = node
      if (node) {
        paintCanvas(node, width, height, label)
      }
    },
    [width, height, label],
  )

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (width / rect.width),
      y: (e.clientY - rect.top) * (height / rect.height),
    }
  }

  const scratch = (x: number, y: number) => {
    const ctx = canvasRef.current?.getContext("2d")
    if (!ctx) return
    ctx.globalCompositeOperation = "destination-out"
    ctx.beginPath()
    ctx.arc(x, y, 20, 0, Math.PI * 2)
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
      revealed.current = true
      setFadeOut(true)
      onReveal()
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
    <div className={styles.container} style={{ width, height }}>
      {children}
      {!fadeOut && (
        <canvas
          ref={canvasCallbackRef}
          className={styles.canvas}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
      )}
    </div>
  )
}
