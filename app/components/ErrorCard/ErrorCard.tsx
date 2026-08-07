import type { ReactNode } from "react"
import { CenteredCardPage } from "~/components/CenteredCardPage/CenteredCardPage"
import { Heading, Stack, StatusIcon, Text } from "@duro-app/ui"

type ErrorCardTone = "error" | "warning" | "info" | "success"

interface ErrorCardProps {
  icon?: "x-circle" | "clock" | "check-done"
  title: string
  message: string
  tone?: ErrorCardTone
  action?: ReactNode
}

export function ErrorCard({ icon = "x-circle", title, message, tone = "error", action }: ErrorCardProps) {
  return (
    <CenteredCardPage>
      {/* StatusIcon stays outside the Stack: it is inline-flex and carries its
          own bottom margin, so a flex parent would blockify it to full width
          and centre the glyph away from the left-aligned text below. */}
      <StatusIcon name={icon} variant={tone} />
      {/* Card lays its children out with no rhythm of its own, so the gaps have
          to come from a Stack — same as every other CenteredCardPage screen.
          Without it the message sits flush against the action button. */}
      <Stack gap="lg">
        <Stack gap="sm">
          <Heading level={1}>{title}</Heading>
          <Text variant="bodyLg" color="muted" as="p">
            {message}
          </Text>
        </Stack>
        {action}
      </Stack>
    </CenteredCardPage>
  )
}
