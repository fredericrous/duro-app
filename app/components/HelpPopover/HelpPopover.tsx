import type { CSSProperties } from "react"
import { useTranslation } from "react-i18next"

const detailsStyle: CSSProperties = {
  display: "inline-block",
  position: "relative",
  marginLeft: 4,
  verticalAlign: "middle",
}

const summaryStyle: CSSProperties = {
  cursor: "pointer",
  listStyle: "none",
  width: 18,
  height: 18,
  borderRadius: 9,
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "currentColor",
  opacity: 0.6,
  background: "transparent",
  fontSize: 11,
  lineHeight: "16px",
  textAlign: "center",
  padding: 0,
  userSelect: "none",
  fontWeight: 600,
}

const popupStyle: CSSProperties = {
  position: "absolute",
  zIndex: 50,
  top: "calc(100% + 4px)",
  left: 0,
  minWidth: 240,
  maxWidth: 320,
  padding: "0.75rem",
  background: "var(--colors-bgCard)",
  color: "var(--colors-text)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--colors-border)",
  borderRadius: 6,
  boxShadow: "0 6px 20px rgba(0,0,0,0.12)",
  fontSize: "0.875rem",
  lineHeight: 1.4,
  whiteSpace: "normal",
  fontWeight: 400,
}

interface HelpPopoverProps {
  /** i18n key for the glossary description, e.g. "glossary.principals" */
  termKey: string
}

/**
 * Inline (?) icon that reveals a short definition for a domain term.
 *
 * Uses native <details>/<summary> for keyboard a11y; toggles open on
 * click/Enter, closes on outside-click via the browser's default details
 * behavior (we keep it simple — no focus trap or escape handler).
 */
export function HelpPopover({ termKey }: HelpPopoverProps) {
  const { t } = useTranslation()
  const label = t("glossary.help") as string
  return (
    <details style={detailsStyle}>
      <summary aria-label={label} title={label} style={summaryStyle}>
        ?
      </summary>
      <div style={popupStyle} role="note">
        {t(termKey) as string}
      </div>
    </details>
  )
}
