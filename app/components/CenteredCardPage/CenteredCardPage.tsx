import type { ReactNode } from "react"
import styles from "./CenteredCardPage.module.css"

interface CenteredCardPageProps {
  children: ReactNode
  className?: string
}

export function CenteredCardPage({ children, className }: CenteredCardPageProps) {
  return (
    <main className={styles.page}>
      <div className={`${styles.card} ${className || ""}`}>{children}</div>
    </main>
  )
}
