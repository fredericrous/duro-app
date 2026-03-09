import type { ReactNode } from "react"
import { Card } from "@duro-app/ui"
import styles from "./CenteredCardPage.module.css"

interface CenteredCardPageProps {
  children: ReactNode
  className?: string
}

export function CenteredCardPage({ children, className }: CenteredCardPageProps) {
  return (
    <main className={styles.page}>
      <div className={`${styles.cardWrapper} ${className || ""}`}>
        <Card variant="elevated" size="full">
          {children}
        </Card>
      </div>
    </main>
  )
}
