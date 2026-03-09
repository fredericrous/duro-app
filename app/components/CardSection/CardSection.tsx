import type { ReactNode } from "react"
import { Card } from "@duro-app/ui"
import styles from "./CardSection.module.css"

interface CardSectionProps {
  title: string
  children: ReactNode
}

export function CardSection({ title, children }: CardSectionProps) {
  return (
    <section className={styles.wrapper}>
      <Card header={title}>{children}</Card>
    </section>
  )
}
