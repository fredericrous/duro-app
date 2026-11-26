import { Effect, Layer, Schedule } from "effect"
import type * as HttpClient from "@effect/platform/HttpClient"
import { CertificateRepo } from "~/lib/services/CertificateRepo.server"
import { VaultCertManagerLive, VaultPkiLive } from "~/lib/services/VaultPki.server"
import { revokeSerialForUser } from "~/lib/workflows/cert-revocation.server"

const SWEEP_BATCH = 25
const SWEEPER_ACTOR = "system:revocation-sweeper"
const REVOCATION_SWEEP_EVERY = "10 minutes"

/**
 * One sweep: revoke every cert whose revocation is pending or failed and due.
 * Returns how many serials it attempted. A failing serial is recorded by
 * `revokeSerialForUser` (attempt count + backoff) and never aborts the sweep.
 */
export const sweepRevocations = Effect.gen(function* () {
  const certRepo = yield* CertificateRepo
  const due = yield* certRepo.listDueRevocations(SWEEP_BATCH)
  yield* Effect.forEach(
    due,
    (cert) =>
      revokeSerialForUser(cert.serialNumber, { auditUsername: cert.username, actorId: SWEEPER_ACTOR, path: "sweeper" }),
    { concurrency: 2 },
  )
  return due.length
}).pipe(Effect.withSpan("sweepRevocations"))

/**
 * The sweeper's production CertManager: the Vault-backed manager over the
 * given HTTP client. Building it reads NAS_VAULT_ADDR and NAS_VAULT_TOKEN, so
 * it fails with a ConfigError when either is unset.
 */
export const makeRevocationSweeperLayer = (httpClient: Layer.Layer<HttpClient.HttpClient>) =>
  VaultCertManagerLive.pipe(Layer.provide(VaultPkiLive), Layer.provide(httpClient))

/**
 * The worker's revocation loop: sweeps every ten minutes for as long as it
 * runs. A defect inside a sweep is logged and the next tick runs; missing
 * Vault configuration disables the sweeper with a log line instead of
 * failing the worker, which still has provisioning and app sync to run.
 */
export const revocationSweepLoop = (httpClient: Layer.Layer<HttpClient.HttpClient>) =>
  sweepRevocations.pipe(
    Effect.tap((attempted) => (attempted > 0 ? Effect.log("worker: revocation sweep", { attempted }) : Effect.void)),
    Effect.catchAllCause((cause) =>
      Effect.logError("worker: revocation sweep failed").pipe(Effect.annotateLogs({ cause: String(cause) })),
    ),
    Effect.repeat(Schedule.spaced(REVOCATION_SWEEP_EVERY)),
    Effect.asVoid,
    Effect.provide(makeRevocationSweeperLayer(httpClient)),
    Effect.catchAll((configError) =>
      Effect.log("worker: revocation sweeper disabled (NAS_VAULT_ADDR / NAS_VAULT_TOKEN unset)", {
        error: String(configError),
      }),
    ),
  )
