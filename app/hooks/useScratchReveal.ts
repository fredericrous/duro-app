import { useState } from "react"

export function useScratchReveal(storageKey: string) {
  const [revealed, setRevealed] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === "1"
    } catch {
      return false
    }
  })

  const onReveal = () => {
    setRevealed(true)
    try {
      localStorage.setItem(storageKey, "1")
    } catch {
      // localStorage may be unavailable
    }
  }

  return { revealed, onReveal }
}
