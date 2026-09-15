import { describe, expect, it } from "vitest"
import { APPLICATION_SCOPE, effectiveGate, parseApprovalRules, sameRules, scopeKey } from "./approval-gates"
import type { ApprovalPolicy } from "./types"

const policy = (overrides: Partial<ApprovalPolicy>): ApprovalPolicy => ({
  id: "pol",
  applicationId: "app",
  scopeType: "application",
  scopeId: null,
  mode: "one_of",
  rules: [{ approverType: "app_owner" }],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...overrides,
})

describe("parseApprovalRules", () => {
  it("accepts an array, a JSON string, and drops malformed entries", () => {
    const rules = [{ approverType: "app_owner" }, { approverType: "principal", approverPrincipalId: "p1" }]
    expect(parseApprovalRules(rules)).toEqual(rules)
    expect(parseApprovalRules(JSON.stringify(rules))).toEqual(rules)
    expect(parseApprovalRules([{ approverType: "nope" }, rules[0], 42])).toEqual([rules[0]])
    expect(parseApprovalRules("not json")).toEqual([])
    expect(parseApprovalRules(null)).toEqual([])
  })
})

describe("effectiveGate", () => {
  const app = policy({ id: "app-wide" })
  const adminRole = policy({
    id: "role-admin",
    scopeType: "role",
    scopeId: "r-admin",
    mode: "all_of",
    rules: [{ approverType: "app_owner" }, { approverType: "principal", approverPrincipalId: "p-marie" }],
  })

  it("is auto-approve with no policy anywhere", () => {
    expect(effectiveGate([], APPLICATION_SCOPE)).toEqual({ mode: "none", rules: [], source: "none" })
    expect(effectiveGate([], { type: "role", id: "r-admin" })).toEqual({ mode: "none", rules: [], source: "none" })
  })

  it("uses the scope's own policy when it has one", () => {
    const gate = effectiveGate([app, adminRole], { type: "role", id: "r-admin" })
    expect(gate.source).toBe("own")
    expect(gate.mode).toBe("all_of")
    expect(gate.rules).toHaveLength(2)
  })

  it("falls back to the application-wide policy for other scopes", () => {
    const gate = effectiveGate([app, adminRole], { type: "role", id: "r-editor" })
    expect(gate).toEqual({ mode: "one_of", rules: [{ approverType: "app_owner" }], source: "inherited" })
    const ent = effectiveGate([app, adminRole], { type: "entitlement", id: "e-read" })
    expect(ent.source).toBe("inherited")
  })

  it("never inherits across scope types — a role policy does not cover an entitlement", () => {
    const gate = effectiveGate([adminRole], { type: "entitlement", id: "r-admin" })
    expect(gate.source).toBe("none")
  })
})

describe("helpers", () => {
  it("keys scopes stably", () => {
    expect(scopeKey(APPLICATION_SCOPE)).toBe("application")
    expect(scopeKey({ type: "entitlement", id: "e1" })).toBe("entitlement:e1")
  })

  it("compares rule lists by approver identity, in order", () => {
    const a = [
      { approverType: "app_owner" as const },
      { approverType: "principal" as const, approverPrincipalId: "p1" },
    ]
    expect(sameRules(a, [...a])).toBe(true)
    expect(sameRules(a, [a[1], a[0]])).toBe(false)
    expect(sameRules(a, [a[0]])).toBe(false)
  })
})
