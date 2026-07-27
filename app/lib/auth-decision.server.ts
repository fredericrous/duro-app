import { Effect } from "effect"
import { AuthzEngine } from "./governance/AuthzEngine.server"
import { runEffect } from "./runtime.server"
import type { AuthInfo } from "./auth.server"

export interface AuthDecisionInput {
  readonly auth: AuthInfo
  readonly application: string
  readonly action: string
  readonly resourceId?: string
}

export interface AuthDecisionResult {
  readonly allow: boolean
}

/**
 * Single entry point for all authorization decisions — the governance
 * AuthzEngine (grants / roles / entitlements) is the source of truth. If the
 * engine errors, the request is denied (fail closed).
 *
 * (The legacy OIDC-group path and the legacy/shadow/dual `AUTH_MODE` ladder
 * were removed once prod cut over to governance; see the auth-mode memory.)
 */
export function checkAuthDecision(input: AuthDecisionInput): Promise<AuthDecisionResult> {
  return runEffect(
    Effect.gen(function* () {
      const engine = yield* AuthzEngine
      const decision = yield* engine.checkAccess({
        subject: input.auth.sub!,
        application: input.application,
        action: input.action,
        resourceId: input.resourceId,
      })
      return { allow: decision.allow }
    }).pipe(
      Effect.catchAll((err) =>
        Effect.logWarning("authz engine failed, treating as deny", { error: String(err) }).pipe(
          Effect.as({ allow: false }),
        ),
      ),
    ),
  )
}
