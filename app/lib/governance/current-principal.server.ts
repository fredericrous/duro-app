import { Data, Effect } from "effect"
import { PrincipalRepo, type PrincipalRepoError } from "./PrincipalRepo.server"
import type { Principal } from "./types"

export class PrincipalNotFound extends Data.TaggedError("PrincipalNotFound")<{
  readonly subject: string
}> {}

/**
 * Resolve the governance principal for an authenticated subject (OIDC `sub`).
 *
 * Fails with a tagged PrincipalNotFound instead of returning null, so routes
 * map "no principal row yet" to their own outcome with catchTag — replacing
 * the `findByExternalId → if (!principal)` dance previously copy-pasted
 * across route actions.
 */
export const requirePrincipal = (
  subject: string,
): Effect.Effect<Principal, PrincipalNotFound | PrincipalRepoError, PrincipalRepo> =>
  Effect.gen(function* () {
    const repo = yield* PrincipalRepo
    const principal = yield* repo.findByExternalId(subject)
    if (!principal) return yield* new PrincipalNotFound({ subject })
    return principal
  })
