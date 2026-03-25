import { Effect } from "effect"
import { authMode } from "./governance-mode.server"
import { AuthzEngine } from "./governance/AuthzEngine.server"
import { runEffect } from "./runtime.server"
import { config } from "./config.server"
import type { AuthInfo } from "./auth.server"
import type { AccessDecision } from "./governance/types"

export interface AuthDecisionInput {
  readonly auth: AuthInfo
  readonly application: string
  readonly action: string
  readonly resourceId?: string
}

export interface AuthDecisionResult {
  readonly allow: boolean
  readonly source: "legacy" | "governance"
  readonly mismatch?: boolean
}

/**
 * Single entry point for all authorization decisions. Mode-aware.
 * Replace scattered OIDC-group checks with this function.
 */
export async function checkAuthDecision(input: AuthDecisionInput): Promise<AuthDecisionResult> {
  const legacyAllow = resolveLegacy(input.auth, input.application, input.action)

  if (authMode === "legacy") {
    return { allow: legacyAllow, source: "legacy" }
  }

  // Governance check (shadow, dual, governance modes)
  let govDecision: AccessDecision
  try {
    govDecision = await runEffect(
      Effect.gen(function* () {
        const engine = yield* AuthzEngine
        return yield* engine.checkAccess({
          subject: input.auth.user!,
          application: input.application,
          action: input.action,
          resourceId: input.resourceId,
        })
      }),
    )
  } catch (err) {
    await runEffect(
      Effect.logWarning("authz engine failed, treating as deny", { error: String(err) }),
    )
    govDecision = { allow: false, matchedGrantIds: [], reasons: ["engine error"] }
  }

  if (authMode === "shadow") {
    const mismatch = legacyAllow !== govDecision.allow
    if (mismatch) {
      await runEffect(
        Effect.logWarning("auth decision mismatch", {
          user: input.auth.user,
          application: input.application,
          action: input.action,
          legacy: legacyAllow,
          governance: govDecision.allow,
        }),
      )
    }
    return { allow: legacyAllow, source: "legacy", mismatch }
  }

  if (authMode === "dual") {
    // Governance first; fallback to legacy ONLY if governance has no opinion
    if (govDecision.matchedGrantIds.length > 0 || govDecision.allow) {
      return { allow: govDecision.allow, source: "governance" }
    }
    return { allow: legacyAllow, source: "legacy" }
  }

  // authMode === "governance"
  return { allow: govDecision.allow, source: "governance" }
}

function resolveLegacy(auth: AuthInfo, application: string, action: string): boolean {
  if (application === "duro" && action === "admin") {
    return auth.groups.includes(config.adminGroupName)
  }
  // Default: legacy allows if user has any group (basic access)
  return auth.groups.length > 0
}
