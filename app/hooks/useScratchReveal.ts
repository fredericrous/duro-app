import { useEffect, useState } from "react"

export function useScratchReveal(storageKey: string) {
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    try {
      if (localStorage.getItem(storageKey) === "1") {
        setRevealed(true)
      }
    } catch {
      // localStorage may be unavailable
    }
  }, [storageKey])

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
