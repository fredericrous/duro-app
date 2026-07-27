import { Effect } from "effect"
import { PrincipalRepo } from "./PrincipalRepo.server"
import { GroupSyncService } from "./GroupSyncService.server"
import { AuditService } from "./AuditService.server"

export interface LoginUser {
  readonly sub: string
  readonly name: string
  readonly email: string
  readonly groups: string[]
}

/**
 * Governance side-effects of a successful OIDC sign-in: upsert the principal,
 * sync OIDC groups into the governance model (group-mappings → grants), and
 * record an `auth.login` audit event.
 *
 * Every pass through the auth callback is a real sign-in — the OIDC round-trip
 * only happens without a valid session — so no dedupe is needed. The audit
 * emit is locally guarded: a failure logs its own message and never blocks
 * the login (the caller keeps its own catchAll as backstop for the sync).
 */
export const syncLogin = (user: LoginUser, ipAddress?: string) =>
  Effect.gen(function* () {
    const principalRepo = yield* PrincipalRepo
    const groupSync = yield* GroupSyncService
    const audit = yield* AuditService

    const principal = yield* principalRepo.ensureUser(user.sub, user.name, user.email)
    yield* groupSync.syncGroups(principal.id, user.groups)

    yield* audit
      .emit({
        eventType: "auth.login",
        actorId: principal.id,
        targetType: "principal",
        targetId: principal.id,
        ipAddress,
      })
      .pipe(Effect.catchAll((e) => Effect.logWarning("auth.login audit emit failed", { error: String(e) })))

    return principal
  })
