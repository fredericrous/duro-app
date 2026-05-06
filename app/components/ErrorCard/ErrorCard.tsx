import type { ReactNode } from "react"
import { CenteredCardPage } from "~/components/CenteredCardPage/CenteredCardPage"
import { Heading, StatusIcon, Text } from "@duro-app/ui"

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
      <StatusIcon name={icon} variant={tone} />
      <Heading level={1}>{title}</Heading>
      <Text variant="bodyLg" color="muted" as="p">
        {message}
      </Text>
      {action}
    </CenteredCardPage>
  )
}
