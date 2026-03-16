import { Link } from "expo-router"
import type { ComponentProps } from "react"
import { colors } from "@duro-app/tokens/tokens/colors.css"
import { radii } from "@duro-app/tokens/tokens/spacing.css"
import { typeScale, typography } from "@duro-app/tokens/tokens/typography.css"
import { css } from "react-strict-dom"

const styles = css.create({
  btn: {
    display: "inline-block",
    padding: "12px 32px",
    borderRadius: radii.sm,
    fontSize: typeScale.fontSize3,
    fontWeight: typography.fontWeightMedium,
    cursor: "pointer",
    borderWidth: 0,
    textDecoration: "none",
  },
  primary: {
    backgroundColor: colors.accent,
    color: colors.accentContrast,
  },
  ghost: {
    padding: "8px 20px",
    backgroundColor: "transparent",
    color: colors.textMuted,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
  },
  small: {
    padding: "6px 12px",
    fontSize: typeScale.fontSize1,
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
