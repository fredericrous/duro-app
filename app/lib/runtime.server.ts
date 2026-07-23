import { ManagedRuntime, Layer, Effect } from "effect"
import { AppLayer, AppDbLive } from "./services/AppLayer.server"

// A shared MemoMap so the DB layer — referenced by BOTH runtimes below — is
// built exactly once: one connection pool. This is essential for the embedded
// PGlite store (single-writer): a second pool would open a second instance on
// the same data directory and corrupt/deadlock it.
const memoMap = Effect.runSync(Layer.makeMemoMap)

const appRuntime = ManagedRuntime.make(AppLayer, memoMap)

// DB-only runtime: provides just the DB (SqlClient + migrations) via the shared
// layer. The readiness probe uses this so it reflects "database reachable" and
// does NOT fail merely because app-feature secrets (LLDAP / Vault / SMTP / OIDC)
// are absent — those belong to features, not to "can this pod serve".
const dbRuntime = ManagedRuntime.make(AppDbLive, memoMap)

type AppServices = ManagedRuntime.ManagedRuntime.Context<typeof appRuntime>
type DbServices = ManagedRuntime.ManagedRuntime.Context<typeof dbRuntime>

/**
 * Run an Effect with the app's service layer. Call this ONLY at route handler
 * level (loader/action). Never call runEffect from inside an Effect.gen — use
 * `yield*` to compose effects instead. Nesting runEffect creates a second
 * runtime context which can double-initialize services.
 */
export function runEffect<A, E>(effect: Effect.Effect<A, E, AppServices>): Promise<A> {
  return appRuntime.runPromise(effect) as Promise<A>
}

/**
 * Run an Effect that needs only the database (e.g. the readiness probe's
 * `SELECT 1`). Shares the app's single connection pool via the MemoMap above.
 */
export function runDbEffect<A, E>(effect: Effect.Effect<A, E, DbServices>): Promise<A> {
  return dbRuntime.runPromise(effect) as Promise<A>
}

// NB: we deliberately do NOT crash the process when the DB is unreachable at
// startup — liveness (/health) must stay DB-independent (the server boots and
// serves without a DB), and a DB outage is handled by the DB-aware readiness
// probe (/health/ready → 503 → kubelet stops routing, and restarts after the
// liveness failureThreshold). Migrations run lazily when the DB layer first
// builds (the readiness probe triggers that within seconds of boot).
