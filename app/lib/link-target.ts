/**
 * How the user wants Duro to open links that leave it.
 *
 * Client-safe on purpose (no `.server` suffix): both the client hook that
 * resolves the mode and the server mutation that validates it import from
 * here, so the union and its guard have exactly one definition.
 *
 *   same_tab · in place (the default, and what NULL means)
 *   new_tab  · always a new tab
 *   auto     · new tab on computers, in place on handhelds/TVs/installed
 */
export type LinkTargetMode = "same_tab" | "new_tab" | "auto"

export const LINK_TARGET_MODES: readonly LinkTargetMode[] = ["auto", "same_tab", "new_tab"]
export const DEFAULT_LINK_TARGET_MODE: LinkTargetMode = "same_tab"

export function isLinkTargetMode(value: unknown): value is LinkTargetMode {
  return typeof value === "string" && (LINK_TARGET_MODES as readonly string[]).includes(value)
}

/**
 * "This is a computer": the PRIMARY input is a mouse or trackpad.
 *
 * Deliberately not the `any-hover`/`any-pointer` family — those report true for
 * a phone with a Bluetooth mouse paired, which is exactly backwards. The
 * conjunction also excludes stylus-primary tablets, which report
 * `pointer: fine` with `hover: none`. No width clause: a desktop browser in a
 * narrow window is still a computer, and a width rule would flip the link
 * target when the window is resized.
 */
export const COMPUTER_QUERY = "(hover: hover) and (pointer: fine)"

/**
 * "Running as an installed app", in any of the installed display modes — the
 * manifest asks for `standalone`, but the UA may downgrade it and the user can
 * change it, so all four count.
 *
 * A comma-separated list rather than `not (display-mode: browser)`: an
 * unrecognised component of a list only disables that component, so engines
 * that don't know `window-controls-overlay` still evaluate the rest, whereas
 * the Level-4 `not (…)` form would fail to parse wholesale on older WebKit.
 */
export const INSTALLED_QUERY =
  "(display-mode: standalone), (display-mode: minimal-ui), (display-mode: fullscreen), (display-mode: window-controls-overlay)"
