import type { ReactNode } from "react"
import { Heading, Panel } from "@duro-app/ui"
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
      <Panel.Root bordered>
        <Panel.Header>
          <Heading level={3}>{title}</Heading>
        </Panel.Header>
        <Panel.Body padded={false}>{children}</Panel.Body>
      </Panel.Root>
    </html.section>
  )
}
