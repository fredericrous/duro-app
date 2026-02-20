import { ManagedRuntime, type Effect } from "effect"
import { AppLayer } from "./services/AppLayer.server"
import type { UserManager } from "./services/UserManager.server"
import type { CertManager } from "./services/CertManager.server"
import type { EmailService } from "./services/EmailService.server"
import type { InviteRepo } from "./services/InviteRepo.server"
import type { PreferencesRepo } from "./services/PreferencesRepo.server"

type AppServices = UserManager | CertManager | EmailService | InviteRepo | PreferencesRepo

const appRuntime = ManagedRuntime.make(AppLayer)

/**
 * Run an Effect with the app's service layer. Call this ONLY at route handler
 * level (loader/action). Never call runEffect from inside an Effect.gen — use
 * `yield*` to compose effects instead. Nesting runEffect creates a second
 * runtime context which can double-initialize services.
 */
export function runEffect<A, E>(effect: Effect.Effect<A, E, AppServices>): Promise<A> {
  return appRuntime.runPromise(effect) as Promise<A>
}
