import { createContext, useContext } from "react"

/**
 * How the signed-in user wants Duro to open links that leave it — provided by
 * the dashboard layout loader (see routes/dashboard.tsx).
 *
 * Default false = same tab, so the browser's Back button returns to Duro.
 * Because this is a context default rather than a router hook, every consumer
 * works unwrapped — including in unit tests — and never throws.
 */
const OpenInNewTabContext = createContext(false)
export const LinkTargetProvider = OpenInNewTabContext.Provider

// Frozen module-level constants: stable identity across renders (no useMemo
// needed), and — the real point — `target` and `rel` are defined once, together,
// so they cannot drift apart at a call site the way they already did once.
const NEW_TAB = Object.freeze({ target: "_blank", rel: "noopener noreferrer" } as const)
const SAME_TAB = Object.freeze({} as const)

export type LinkTargetProps = { readonly target?: "_blank"; readonly rel?: string }

/**
 * Anchor props for a link that leaves Duro. Spread onto `html.a` or the DS
 * `LinkButton` — both accept `target` and `rel`:
 *
 *   <html.a href={app.url} {...useLinkTarget()}>…</html.a>
 *
 * Whatever this returns, the links stay real anchors: Cmd/Ctrl-click and
 * middle-click still open a new tab regardless of the preference.
 */
export function useLinkTarget(): LinkTargetProps {
  return useContext(OpenInNewTabContext) ? NEW_TAB : SAME_TAB
}
