import { Link } from "expo-router"
import type { ComponentProps } from "react"
import { css } from "react-strict-dom"

const styles = css.create({
  btn: {
    display: "inline-block",
    padding: "12px 32px",
    borderRadius: 4,
    fontSize: "0.875rem",
    fontWeight: "500",
    cursor: "pointer",
    borderWidth: 0,
    textDecoration: "none",
  },
  primary: {
    backgroundColor: "#6366f1",
    color: "#fff",
  },
  ghost: {
    padding: "8px 20px",
    backgroundColor: "transparent",
    color: "#999",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "#333",
  },
  small: {
    padding: "6px 12px",
    fontSize: "0.75rem",
  },
})

type ButtonLinkProps = ComponentProps<typeof Link> & {
  variant?: "primary" | "ghost"
  size?: "default" | "small"
}

export function ButtonLink({ variant = "primary", size = "default", style, ...props }: ButtonLinkProps) {
  return (
    <Link
      style={[
        styles.btn as any,
        variant === "primary" ? (styles.primary as any) : (styles.ghost as any),
        size === "small" ? (styles.small as any) : undefined,
        style,
      ]}
      {...props}
    />
  )
}
