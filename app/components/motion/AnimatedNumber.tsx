import { useEffect, useRef, useState } from "react"
import { useReducedMotion } from "~/lib/useReducedMotion"

interface AnimatedNumberProps {
  value: number
  /** Tween duration in milliseconds. */
  durationMs?: number
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

/**
 * A number that tweens to its target whenever `value` changes — a small
 * "count up/down" that gives stats a sense of live change after a sync or a new
 * grant, instead of snapping. No animation on first mount (keeps the SSR output
 * stable through hydration) and an instant jump under prefers-reduced-motion.
 */
export function AnimatedNumber({ value, durationMs = 500 }: AnimatedNumberProps) {
  const reduced = useReducedMotion()
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(value)
  const mountedRef = useRef(false)

  useEffect(() => {
    // First mount: adopt the value without animating so server and client
    // render the same thing.
    if (!mountedRef.current) {
      mountedRef.current = true
      fromRef.current = value
      setDisplay(value)
      return
    }
    if (reduced || fromRef.current === value) {
      fromRef.current = value
      setDisplay(value)
      return
    }

    const from = fromRef.current
    const to = value
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs)
      const current = Math.round(from + (to - from) * easeOutCubic(progress))
      setDisplay(current)
      // Track the live value so a tween interrupted by a new `value` resumes
      // from where it is on screen instead of snapping back to the old start.
      fromRef.current = current
      if (progress < 1) {
        raf = requestAnimationFrame(tick)
      } else {
        fromRef.current = to
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, reduced, durationMs])

  return <>{display}</>
}
