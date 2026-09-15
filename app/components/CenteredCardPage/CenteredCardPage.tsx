import type { ReactNode } from "react"
import { Card } from "@duro-app/ui"
import { css, html } from "react-strict-dom"
import { spacing } from "@duro-app/tokens/tokens/spacing.css"

const styles = css.create({
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
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
