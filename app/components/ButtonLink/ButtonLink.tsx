import { Link } from "react-router"
import type { ComponentProps } from "react"
import styles from "./ButtonLink.module.css"

type ButtonLinkProps = ComponentProps<typeof Link> & {
  variant?: "primary" | "ghost"
  size?: "default" | "small"
}

export function ButtonLink({
  variant = "primary",
  size = "default",
  className,
  ...props
}: ButtonLinkProps) {
  const cls = [
    styles.btn,
    variant === "primary" ? styles.primary : styles.ghost,
    size === "small" ? styles.small : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ")

  return <Link className={cls} {...props} />
}
