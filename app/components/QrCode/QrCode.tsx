import { useMemo } from "react"
import { encode } from "uqr"

/**
 * Static SVG QR code, rendered inline (no canvas, no external requests — the
 * matrix comes from `uqr`, a zero-dependency encoder). One <path> for every
 * dark module keeps the DOM small and lets the SVG scale losslessly.
 *
 * Always rendered black-on-white inside its own quiet zone regardless of app
 * theme: scanner contrast beats theme purity, and the border is part of the
 * QR spec (uqr includes it in the matrix via `border`).
 */
export function QrCode({ value, size = 224, label }: { value: string; size?: number; label: string }) {
  const { path, modules } = useMemo(() => {
    const qr = encode(value, { border: 2, ecc: "M" })
    let d = ""
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) {
        if (qr.data[y][x]) d += `M${x},${y}h1v1h-1z`
      }
    }
    return { path: d, modules: qr.size }
  }, [value])

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${modules} ${modules}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
    >
      <rect width={modules} height={modules} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  )
}
