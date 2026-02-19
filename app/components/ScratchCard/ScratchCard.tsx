import { useRef, useEffect, useCallback, useState, type ReactNode } from "react"
import styles from "./ScratchCard.module.css"

interface ScratchCardProps {
  width: number
  height: number
  revealThreshold?: number
  onReveal: () => void
  label?: string
  children: ReactNode
}

export function ScratchCard({
  width,
  height,
  revealThreshold = 0.5,
  onReveal,
  label = "Scratch to reveal",
  children,
}: ScratchCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isDrawing = useRef(false)
  const revealed = useRef(false)
  const [fadeOut, setFadeOut] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    canvas.width = width
    canvas.height = height

    // Fill with scratch overlay
    ctx.fillStyle = "#333"
    ctx.fillRect(0, 0, width, height)

    // Draw label text
    ctx.fillStyle = "#999"
    ctx.font = "14px -apple-system, BlinkMacSystemFont, sans-serif"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(label, width / 2, height / 2)
  }, [width, height, label])

  const getPos = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current!.getBoundingClientRect()
      return {
        x: (e.clientX - rect.left) * (width / rect.width),
        y: (e.clientY - rect.top) * (height / rect.height),
      }
    },
    [width, height],
  )

  const scratch = useCallback((x: number, y: number) => {
    const ctx = canvasRef.current?.getContext("2d")
    if (!ctx) return

    ctx.globalCompositeOperation = "destination-out"
    ctx.beginPath()
    ctx.arc(x, y, 20, 0, Math.PI * 2)
    ctx.fill()
  }, [])

  const checkReveal = useCallback(() => {
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
  }, [revealThreshold, onReveal])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (revealed.current) return
      isDrawing.current = true
      canvasRef.current?.setPointerCapture(e.pointerId)
      const pos = getPos(e)
      scratch(pos.x, pos.y)
    },
    [getPos, scratch],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isDrawing.current || revealed.current) return
      const pos = getPos(e)
      scratch(pos.x, pos.y)
    },
    [getPos, scratch],
  )

  const onPointerUp = useCallback(() => {
    if (!isDrawing.current) return
    isDrawing.current = false
    checkReveal()
  }, [checkReveal])

  if (fadeOut) return null

  return (
    <div className={styles.container} style={{ width, height }}>
      {children}
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />
    </div>
  )
}
