import { Schema } from "effect"
import type { ApprovalMode, ApprovalPolicy, ApprovalPolicyRule } from "./types"

// ---------------------------------------------------------------------------
// Pure model behind the approval gate board. Client-safe: no server imports.
//
// A request lands on ONE scope — the role or entitlement it names — and the
// workflow resolves the policy for it as "most specific wins": an entitlement
// or role policy beats the application-wide one, and an application with no
// policy at all auto-approves. This module makes that resolution explicit so
// the UI can show, per scope, what would actually happen.
// ---------------------------------------------------------------------------

/** The scopes the gate board edits. `resource` exists in the schema but the
 *  request workflow never resolves it, so the board leaves it out. */
export const GateScopeType = Schema.Literal("application", "role", "entitlement")
export type GateScopeType = typeof GateScopeType.Type

export type GateScope =
  | { readonly type: "application"; readonly id: null }
  | { readonly type: "role" | "entitlement"; readonly id: string }

export const APPLICATION_SCOPE: GateScope = { type: "application", id: null }

export const scopeKey = (scope: GateScope): string =>
  scope.type === "application" ? "application" : `${scope.type}:${scope.id}`

export const ApprovalPolicyRuleSchema = Schema.Struct({
  approverType: Schema.Literal("app_owner", "principal"),
  approverPrincipalId: Schema.optional(Schema.String),
})

/** Rules ride as JSONB; decode tolerantly so one malformed row never blanks
 *  the whole board — a rule that doesn't parse is dropped, not fatal. */
export function parseApprovalRules(raw: unknown): ApprovalPolicyRule[] {
  const list = typeof raw === "string" ? safeJson(raw) : raw
  if (!Array.isArray(list)) return []
  const decode = Schema.decodeUnknownOption(ApprovalPolicyRuleSchema)
  return list.flatMap((item) => {
    const rule = decode(item)
    return rule._tag === "Some" ? [rule.value] : []
  })
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

export interface EffectiveGate {
  readonly mode: ApprovalMode
  readonly rules: ApprovalPolicyRule[]
  /** `own`: this scope has its own policy. `inherited`: it follows the
   *  application-wide policy. `none`: nothing applies — auto-approve. */
  readonly source: "own" | "inherited" | "none"
}

const policyFor = (policies: ReadonlyArray<ApprovalPolicy>, scope: GateScope): ApprovalPolicy | undefined =>
  policies.find((p) =>
    scope.type === "application"
      ? p.scopeType === "application" && p.scopeId === null
      : p.scopeType === scope.type && p.scopeId === scope.id,
  )

/** What a request on `scope` would face today, mirroring
 *  AccessRequestRepo.findApprovalPolicy + the workflow's no-policy fallback. */
export function effectiveGate(policies: ReadonlyArray<ApprovalPolicy>, scope: GateScope): EffectiveGate {
  const own = policyFor(policies, scope)
  if (own) return { mode: own.mode, rules: parseApprovalRules(own.rules), source: "own" }
  if (scope.type !== "application") {
    const app = policyFor(policies, APPLICATION_SCOPE)
    if (app) return { mode: app.mode, rules: parseApprovalRules(app.rules), source: "inherited" }
  }
  return { mode: "none", rules: [], source: "none" }
}

/** Two rules name the same approver. */
export const sameApprover = (a: ApprovalPolicyRule, b: ApprovalPolicyRule): boolean =>
  a.approverType === b.approverType &&
  (a.approverType === "app_owner" || a.approverPrincipalId === b.approverPrincipalId)

export const sameRules = (a: ReadonlyArray<ApprovalPolicyRule>, b: ReadonlyArray<ApprovalPolicyRule>): boolean =>
  a.length === b.length && a.every((rule, i) => sameApprover(rule, b[i]))
