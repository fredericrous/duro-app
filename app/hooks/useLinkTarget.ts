import { createContext, useContext } from "react"
import { COMPUTER_QUERY, DEFAULT_LINK_TARGET_MODE, INSTALLED_QUERY, type LinkTargetMode } from "~/lib/link-target"
import { useMediaQuery } from "./useMediaQuery"

/**
 * How the signed-in user wants Duro to open links that leave it — provided by
 * the dashboard layout loader (see routes/dashboard.tsx).
 *
 * Because this is a context default rather than a router hook, every consumer
 * works unwrapped — including in unit tests — and never throws.
 */
const LinkTargetModeContext = createContext<LinkTargetMode>(DEFAULT_LINK_TARGET_MODE)
export const LinkTargetProvider = LinkTargetModeContext.Provider

// Frozen module-level constants: stable identity across renders (no useMemo
// needed), and — the real point — `target` and `rel` are defined once,
// together, so they cannot drift apart at a call site the way they already did
// once.
const NEW_TAB = Object.freeze({ target: "_blank", rel: "noopener noreferrer" } as const)
const SAME_TAB = Object.freeze({} as const)

export type LinkTargetProps = { readonly target?: "_blank"; readonly rel?: string }

/**
 * Anchor props for a link that leaves Duro. Spread onto `html.a` or the DS
 * `LinkButton` — both accept `target` and `rel`:
 *
 *   <html.a href={app.url} {...useLinkTarget()}>…</html.a>
 *
 * In "auto" the answer comes from the device itself: a new tab only where
 * there are tabs to spare — a primary mouse/trackpad — and not when Duro is
 * running as an installed app, where a new tab means a jarring jump out to the
 * browser.
 *
 * SSR resolves "auto" to same-tab (useMediaQuery's serverDefault) and the
 * client corrects on hydration. That correction is an ordinary state update,
 * not a hydration mismatch. Being honest about the seam: anchors work before
 * hydration, so a computer user in "auto" who clicks within those few
 * milliseconds gets a same-tab navigation — it degrades to the app's own
 * default, and nothing is painted differently, unlike the theme.
 */
export function useLinkTarget(): LinkTargetProps {
  const mode = useContext(LinkTargetModeContext)
  // Called unconditionally, before any branch — hook order must not depend on
  // the mode (mirrors useResolvedTheme).
  const isComputer = useMediaQuery(COMPUTER_QUERY, false)
  const isInstalled = useMediaQuery(INSTALLED_QUERY, false)

  if (mode === "new_tab") return NEW_TAB
  if (mode === "same_tab") return SAME_TAB
  return isComputer && !isInstalled ? NEW_TAB : SAME_TAB
}
