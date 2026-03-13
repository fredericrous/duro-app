import { CenteredCardPage } from "~/components/CenteredCardPage/CenteredCardPage"
import { Heading, StatusIcon, Text } from "@duro-app/ui"

interface ErrorCardProps {
  icon?: "x-circle" | "clock" | "check-done"
  title: string
  message: string
}

export function ErrorCard({ icon = "x-circle", title, message }: ErrorCardProps) {
  return (
    <CenteredCardPage>
      <StatusIcon name={icon} variant="error" />
      <Heading level={1}>{title}</Heading>
      <Text variant="bodyLg" color="muted" as="p">{message}</Text>
    </CenteredCardPage>
  )
}
