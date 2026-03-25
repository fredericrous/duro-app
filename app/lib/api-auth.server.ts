import { Effect } from "effect"
import { getSession } from "./session.server"
import { PrincipalRepo } from "./governance/PrincipalRepo.server"
import { ApiKeyRepo } from "./governance/ApiKeyRepo.server"
import { runEffect } from "./runtime.server"

export interface ApiAuthResult {
  readonly principalId: string
  readonly scopes: string[]
  readonly source: "session" | "api_key"
}

/**
 * Authenticate API route requests via session cookie or API key.
 * Throws 401 Response if neither is valid.
 */
export async function requireApiAuth(request: Request): Promise<ApiAuthResult> {
  // 1. Try session cookie
  const session = await getSession(request)
  if (session) {
    const principal = await runEffect(
      Effect.gen(function* () {
        const repo = yield* PrincipalRepo
        return yield* repo.findByExternalId(session.name)
      }),
    )
    if (principal) {
      return { principalId: principal.id, scopes: ["*"], source: "session" }
    }
  }

  // 2. Try Authorization header (Bearer duro_...)
  const authHeader = request.headers.get("Authorization")
  if (authHeader?.startsWith("Bearer duro_")) {
    const rawKey = authHeader.slice(7) // strip "Bearer "
    const keyInfo = await runEffect(
      Effect.gen(function* () {
        const repo = yield* ApiKeyRepo
        return yield* repo.verify(rawKey)
      }),
    )
    if (keyInfo) {
      return { principalId: keyInfo.principalId, scopes: keyInfo.scopes, source: "api_key" }
    }
  }

  throw new Response("Unauthorized", { status: 401 })
}

/**
 * Check if the authenticated caller has the required scope.
 */
export function requireScope(auth: ApiAuthResult, scope: string): void {
  if (auth.scopes.includes("*") || auth.scopes.includes(scope)) {
    return
  }
  throw new Response("Forbidden: insufficient scope", { status: 403 })
}
