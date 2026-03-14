import type { ReactNode } from "react"
import { Card } from "@duro-app/ui"
import { css, html } from "react-strict-dom"

const styles = css.create({
  wrapper: {
    marginBottom: 24,
  },
})

interface CardSectionProps {
  title: string
  children: ReactNode
}

export function CardSection({ title, children }: CardSectionProps) {
  return (
    <html.section style={styles.wrapper}>
      <Card header={title}>{children}</Card>
    </html.section>
  )
}
