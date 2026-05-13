// @vitest-environment node
import { describe, expect, it } from "vitest"
import { computeState } from "./apps-catalog.server"

const set = (...ids: string[]) => new Set<string>(ids)

// Pinning the per-app state matrix. Adding a new state or changing a transition
// rule should require updating this file — that's the point.
describe("computeState", () => {
  it("open access modes always resolve to 'open' regardless of grants/pending", () => {
    expect(computeState({ accessMode: "open" }, set(), set(), set(), 0)).toBe("open")
    // Even if a user somehow has a grant on an open app, the public surface is
    // still 'open' — no request UI applies.
    expect(computeState({ accessMode: "open" }, set("a"), set(), set(), 3)).toBe("open")
  })

  it("a pending role request blocks the row regardless of grants", () => {
    expect(computeState({ accessMode: "request" }, set(), set("x"), set(), 3)).toBe("pending")
    // Even if the user already has a grant on a different role, a pending
    // request is the most actionable state to surface.
    expect(computeState({ accessMode: "request" }, set("a"), set("x"), set(), 3)).toBe("pending")
  })

  it("a pending entitlement request also resolves to 'pending'", () => {
    expect(computeState({ accessMode: "request" }, set(), set(), set("y"), 3)).toBe("pending")
  })

  it("no grant + request mode = 'requestable'", () => {
    expect(computeState({ accessMode: "request" }, set(), set(), set(), 3)).toBe("requestable")
  })

  it("no grant + invite_only mode = 'invite_only'", () => {
    expect(computeState({ accessMode: "invite_only" }, set(), set(), set(), 3)).toBe("invite_only")
  })

  it("at least one grant but missing roles = 'granted_can_upgrade'", () => {
    expect(computeState({ accessMode: "request" }, set("a"), set(), set(), 3)).toBe("granted_can_upgrade")
    expect(computeState({ accessMode: "request" }, set("a", "b"), set(), set(), 3)).toBe("granted_can_upgrade")
  })

  it("grants cover every defined role = 'granted_full'", () => {
    expect(computeState({ accessMode: "request" }, set("a", "b", "c"), set(), set(), 3)).toBe("granted_full")
  })

  it("grants exceed defined roles (drift) = 'granted_full'", () => {
    // If granted set somehow exceeds the role count (e.g. a role was deleted
    // after the grant was issued), still treat as fully granted.
    expect(computeState({ accessMode: "request" }, set("a", "b", "stale"), set(), set(), 2)).toBe("granted_full")
  })

  it("no defined roles + no grants in request mode = 'requestable'", () => {
    // Edge case: an app exists but has no roles configured yet. Since there's
    // nothing to grant 'fully', surface as requestable so admins notice the
    // missing role definition the next time someone tries to ask.
    expect(computeState({ accessMode: "request" }, set(), set(), set(), 0)).toBe("requestable")
  })
})
