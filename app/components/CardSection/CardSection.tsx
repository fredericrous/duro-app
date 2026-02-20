import type { ReactNode } from "react"
import styles from "./CardSection.module.css"

interface CardSectionProps {
  title: string
  children: ReactNode
}

export function CardSection({ title, children }: CardSectionProps) {
  return (
    <section className={styles.card}>
      <h2 className={styles.title}>{title}</h2>
      {children}
    </section>
  )
}
