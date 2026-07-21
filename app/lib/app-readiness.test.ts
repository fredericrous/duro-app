import { describe, it, expect } from "vitest"
import { applicationReadiness, READINESS_ORDER, type ReadinessSignals } from "./app-readiness"

const s = (o: Partial<ReadinessSignals>): ReadinessSignals => ({
  hasOwner: false,
  hasDescription: false,
  hasTarget: false,
  hasGrant: false,
  ...o,
})

describe("applicationReadiness", () => {
  it("is draft until BOTH owner and description are set", () => {
    expect(applicationReadiness(s({}))).toBe("draft")
    expect(applicationReadiness(s({ hasOwner: true }))).toBe("draft")
    expect(applicationReadiness(s({ hasDescription: true }))).toBe("draft")
    // even with a role/grant, incomplete metadata keeps it draft
    expect(applicationReadiness(s({ hasTarget: true, hasGrant: true }))).toBe("draft")
  })

  it("is configured once metadata is complete but there's nothing to grant", () => {
    expect(applicationReadiness(s({ hasOwner: true, hasDescription: true }))).toBe("configured")
  })

  it("is grantable once it has a role/entitlement but no active grant", () => {
    expect(applicationReadiness(s({ hasOwner: true, hasDescription: true, hasTarget: true }))).toBe("grantable")
  })

  it("is provisioned once someone holds an active grant", () => {
    expect(applicationReadiness(s({ hasOwner: true, hasDescription: true, hasTarget: true, hasGrant: true }))).toBe(
      "provisioned",
    )
  })

  it("levels are a strictly ascending ladder", () => {
    expect(READINESS_ORDER.draft).toBeLessThan(READINESS_ORDER.configured)
    expect(READINESS_ORDER.configured).toBeLessThan(READINESS_ORDER.grantable)
    expect(READINESS_ORDER.grantable).toBeLessThan(READINESS_ORDER.provisioned)
  })
})
