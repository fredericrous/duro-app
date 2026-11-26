import { Effect, Layer, Schedule } from "effect"
import type * as HttpClient from "@effect/platform/HttpClient"
import { VaultCertManagerLive, VaultPkiLive } from "~/lib/services/VaultPki.server"
import { sweepRevocations } from "~/lib/workflows/revocation-sweep.server"

const REVOCATION_SWEEP_EVERY = "10 minutes"

/**
 * The sweeper's production CertManager: the Vault-backed manager over the
 * given HTTP client. Building it reads NAS_VAULT_ADDR and NAS_VAULT_TOKEN, so
 * it fails with a ConfigError when either is unset.
 */
export const makeRevocationSweeperLayer = (httpClient: Layer.Layer<HttpClient.HttpClient>) =>
  VaultCertManagerLive.pipe(Layer.provide(VaultPkiLive), Layer.provide(httpClient))

/**
 * The worker's revocation loop: sweeps every ten minutes for as long as it
 * runs. A defect inside a sweep is logged and the next tick runs; an
 * unavailable Vault layer (missing configuration) disables the sweeper with a
 * warning instead of failing the worker, which still has provisioning and app
 * sync to run.
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
    Effect.catchAll((layerError) =>
      Effect.logWarning("worker: revocation sweeper disabled: Vault layer unavailable").pipe(
        Effect.annotateLogs({ error: String(layerError) }),
      ),
    ),
  )
