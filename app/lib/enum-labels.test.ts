import { describe, it, expect } from "vitest"
import { enumLabel, humanizeEnum } from "./enum-labels"

// Minimal t: returns a known key, else the provided defaultValue.
const known: Record<string, string> = { "common.enums.accessMode.invite_only": "Invite only" }
const t = (key: string, opts?: Record<string, unknown>) => known[key] ?? (opts?.defaultValue as string) ?? key

describe("humanizeEnum", () => {
  it("turns snake/dotted tokens into readable text", () => {
    expect(humanizeEnum("invite_only")).toBe("Invite only")
    expect(humanizeEnum("grant.created")).toBe("Grant created")
    expect(humanizeEnum("service_account")).toBe("Service account")
  })
})

describe("enumLabel", () => {
  it("prefers an explicit i18n key", () => {
    expect(enumLabel(t, "accessMode", "invite_only")).toBe("Invite only")
  })
  it("falls back to a humanized token when no key exists", () => {
    expect(enumLabel(t, "eventType", "grant.created")).toBe("Grant created")
  })
  it("renders an em-dash for empty values", () => {
    expect(enumLabel(t, "accessMode", null)).toBe("—")
    expect(enumLabel(t, "accessMode", undefined)).toBe("—")
  })
})
