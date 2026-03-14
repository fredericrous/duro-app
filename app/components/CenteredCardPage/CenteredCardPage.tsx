import type { ReactNode } from "react"
import { Card } from "@duro-app/ui"
import { css, html } from "react-strict-dom"

const styles = css.create({
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  cardWrapper: {
    maxWidth: 480,
    width: "100%",
  },
})

interface CenteredCardPageProps {
  children: ReactNode
}

export function CenteredCardPage({ children }: CenteredCardPageProps) {
  return (
    <html.main style={styles.page}>
      <html.div style={styles.cardWrapper}>
        <Card variant="elevated" size="full">
          {children}
        </Card>
      </html.div>
    </html.main>
  )
}
