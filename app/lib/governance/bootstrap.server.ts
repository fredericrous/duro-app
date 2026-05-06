import { Effect } from "effect"
import { UserManager } from "~/lib/services/UserManager.server"
import { config } from "~/lib/config.server"

// Once we observe a single human user, the deployment is no longer in
// "first-run" state and never goes back. Cache positively so subsequent
// requests skip the LLDAP round-trip.
let bootstrapped = false

/**
 * True iff the deployment has no human users yet (system accounts like the
 * `admin` LLDAP root and `*-service` accounts are filtered out via
 * `config.isSystemUser`).
 *
 * On any LLDAP error we deliberately return `false` — we do not want a
 * transient outage to redirect every request to the setup wizard. The
 * underlying error surfaces elsewhere when callers try to use LLDAP for
 * real work.
 */
export const isFirstRun: Effect.Effect<boolean, never, UserManager> = Effect.gen(function* () {
  if (bootstrapped) return false

  const userMgr = yield* UserManager
  const result = yield* userMgr.getUsers.pipe(Effect.either)
  if (result._tag === "Left") {
    return false
  }
  const humans = result.right.filter((u) => !config.isSystemUser(u.id))
  if (humans.length > 0) {
    bootstrapped = true
    return false
  }
  return true
})

/** @internal — for tests only. */
export const __resetBootstrapCache = () => {
  bootstrapped = false
}
