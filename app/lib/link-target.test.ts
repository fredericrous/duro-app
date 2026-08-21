import { describe, expect, it } from "vitest"
import { DEFAULT_LINK_TARGET_MODE, isLinkTargetMode, LINK_TARGET_MODES } from "./link-target"

describe("isLinkTargetMode", () => {
  it.each(LINK_TARGET_MODES)("accepts %j", (mode) => {
    expect(isLinkTargetMode(mode)).toBe(true)
  })

  it.each(["true", "false", "on", "", "blank", "_blank", null, undefined, 1, {}])("rejects %j", (value) => {
    // "true"/"false" matter specifically: that was 0033's encoding, and a
    // stale bundle posting it must be rejected rather than coerced.
    expect(isLinkTargetMode(value)).toBe(false)
  })

  it("defaults to same-tab, so NULL and garbage both mean 'in place'", () => {
    expect(DEFAULT_LINK_TARGET_MODE).toBe("same_tab")
  })
})
