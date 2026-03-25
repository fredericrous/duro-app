import { ManagedRuntime, type Effect } from "effect"
import { AppLayer } from "./services/AppLayer.server"

const appRuntime = ManagedRuntime.make(AppLayer)

type AppServices = ManagedRuntime.ManagedRuntime.Context<typeof appRuntime>

/**
 * Run an Effect with the app's service layer. Call this ONLY at route handler
 * level (loader/action). Never call runEffect from inside an Effect.gen — use
 * `yield*` to compose effects instead. Nesting runEffect creates a second
 * runtime context which can double-initialize services.
 */
export function runEffect<A, E>(effect: Effect.Effect<A, E, AppServices>): Promise<A> {
  return appRuntime.runPromise(effect) as Promise<A>
}
