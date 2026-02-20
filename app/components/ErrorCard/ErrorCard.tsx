import { CenteredCardPage } from "~/components/CenteredCardPage/CenteredCardPage"
import { StatusIcon } from "~/components/StatusIcon/StatusIcon"
import styles from "./ErrorCard.module.css"

interface ErrorCardProps {
  icon?: "x-circle" | "clock" | "check-done"
  title: string
  message: string
}

export function ErrorCard({ icon = "x-circle", title, message }: ErrorCardProps) {
  return (
    <CenteredCardPage>
      <StatusIcon name={icon} variant="error" />
      <h1>{title}</h1>
      <p className={styles.message}>{message}</p>
    </CenteredCardPage>
  )
}
