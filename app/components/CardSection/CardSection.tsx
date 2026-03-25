import type { ReactNode } from "react"
import { Heading, Panel } from "@duro-app/ui"
import { css, html } from "react-strict-dom"

const styles = css.create({
  wrapper: {
    marginBottom: 24,
  },
  headerRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
  },
})

interface CardSectionProps {
  title: string
  action?: ReactNode
  children: ReactNode
}

export function CardSection({ title, action, children }: CardSectionProps) {
  return (
    <html.section style={styles.wrapper}>
      <Panel.Root bordered>
        <Panel.Header>
          <html.div style={styles.headerRow}>
            <Heading level={3}>{title}</Heading>
            {action}
          </html.div>
        </Panel.Header>
        <Panel.Body padded={false}>{children}</Panel.Body>
      </Panel.Root>
    </html.section>
  )
}
