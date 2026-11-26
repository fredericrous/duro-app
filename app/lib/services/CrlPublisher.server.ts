/**
 * Publishes the `pki-client` CRL for Envoy (plan 2026-11-25, Phase 2).
 *
 * duro-worker rebuilds Vault's CRL, checks it, and writes it to NAS Vault KV
 * `secret/pki/client-crl` (key `ca.crl`); the homelab broker copies it to the
 * main Vault and ESO hands it to Envoy Gateway. It publishes at start (the
 * runbook's force-publish is a worker restart), every 6 h, and within a 30 s
 * tick of a revocation completing: revocations complete in the web pods, so
 * the worker watches the DB.
 *
 * Every `crl/rotate` re-signs the CRL with a fresh thisUpdate/nextUpdate, so
 * in production each cycle writes KV; the content comparison only skips a
 * write when Vault hands back the very CRL KV already holds.
 *
 * Its ports are declared here and implemented by adapters: `VaultCrl`
 * (VaultCrl.server.ts), `CrlDb` (CrlDb.server.ts) and `CertManager`.
 */
// tsyringe, which @peculiar/x509 loads, throws at import without this polyfill.
import "reflect-metadata"
import * as x509 from "@peculiar/x509"
import { Cause, Clock, Context, Data, Effect, Option, Ref, Schedule } from "effect"
import { CertManager, type CertManagerError } from "~/lib/services/CertManager.server"

const DAY_MS = 86_400_000
/** A CRL that expires sooner than this is refused: Envoy would soon refuse every client. */
export const MIN_CRL_VALIDITY_MS = 3 * DAY_MS
export const PUBLISH_EVERY_MS = 6 * 3_600_000
/** After a failed cycle, the next attempt waits this long (a down Vault is not hammered). */
export const RETRY_AFTER_FAILURE_MS = 5 * 60_000
export const TICK_EVERY = "30 seconds"
/** Re-revocations per cycle: a serial Vault keeps leaving out must not loop. */
export const MAX_REREVOKES_PER_CYCLE = 10
/** One re-revoke gives up after this, logged with its serial; the batch moves on. */
export const REREVOKE_TIMEOUT = "8 seconds"
/**
 * A whole cycle gives up after this: its worst case, 6 Vault calls at 15 s and
 * 10 re-revokes at 8 s, is 170 s. It stays under the 5 min retry interval.
 */
export const CYCLE_DEADLINE = "4 minutes"

/** Colon hex as Vault and the DB store it, or bare hex from a CRL, compared alike. */
export const canonicalSerial = (serial: string): string => serial.replace(/:/g, "").toLowerCase().replace(/^0+/, "")

export class CrlInvalid extends Data.TaggedError("CrlInvalid")<{ readonly reason: string }> {}

export type CrlSourceOperation = "rotate" | "crl/pem" | "cert/ca" | "read client-crl" | "write client-crl"

/** A failed or timed-out call to the CRL's source (Vault). */
export class CrlSourceError extends Data.TaggedError("CrlSourceError")<{
  readonly operation: CrlSourceOperation
  readonly message: string
  readonly status?: number
  readonly cause?: unknown
}> {}

export class CrlDbError extends Data.TaggedError("CrlDbError")<{
  readonly operation: "watermark" | "completedSerials" | "pendingCount"
  readonly cause: unknown
}> {}

export class CrlCycleTimeout extends Data.TaggedError("CrlCycleTimeout")<{ readonly after: string }> {}

// --- ports ---

/** Where the CRL comes from and where its published copy lives. */
export class VaultCrl extends Context.Tag("VaultCrl")<
  VaultCrl,
  {
    /** Rebuilds the CRL with a fresh nextUpdate. */
    readonly rotateCrl: Effect.Effect<void, CrlSourceError>
    /** The current CRL, PEM. */
    readonly getCrlPem: Effect.Effect<string, CrlSourceError>
    /** The CA that signs it, PEM. */
    readonly getCaPem: Effect.Effect<string, CrlSourceError>
    /** The published copy, or none when nothing was published yet. */
    readonly readPublishedCrl: Effect.Effect<Option.Option<string>, CrlSourceError>
    readonly writePublishedCrl: (pem: string) => Effect.Effect<void, CrlSourceError>
  }
>() {}

/** What the publisher reads from duro's certificate rows. */
export class CrlDb extends Context.Tag("CrlDb")<
  CrlDb,
  {
    /** Changes whenever a revocation completes (count and latest time, so no commit order hides one). */
    readonly revocationWatermark: Effect.Effect<string, CrlDbError>
    /** Serials revoked in Vault (`completed`) that have not expired: each must be on the CRL. */
    readonly completedUnexpiredSerials: Effect.Effect<ReadonlyArray<string>, CrlDbError>
    /** Revocations not yet done in Vault (`pending` or `failed`), unexpired. */
    readonly pendingRevocations: Effect.Effect<number, CrlDbError>
  }
>() {}

// --- validation ---

export interface ValidatedCrl {
  readonly pem: string
  readonly nextUpdate: Date
  /** Canonical serials the CRL lists. */
  readonly serials: ReadonlySet<string>
}

/** Parses the CRL, checks the CA signed it and that it is valid for at least three more days. */
export const validateCrl = (crlPem: string, caPem: string, nowMs: number): Effect.Effect<ValidatedCrl, CrlInvalid> =>
  Effect.gen(function* () {
    const crl = yield* Effect.try({
      try: () => new x509.X509Crl(crlPem),
      catch: (e) => new CrlInvalid({ reason: `not a CRL: ${String(e)}` }),
    })
    const ca = yield* Effect.try({
      try: () => new x509.X509Certificate(caPem),
      catch: (e) => new CrlInvalid({ reason: `not a CA certificate: ${String(e)}` }),
    })
    const signed = yield* Effect.tryPromise({
      try: () => crl.verify({ publicKey: ca }),
      catch: (e) => new CrlInvalid({ reason: `signature check failed: ${String(e)}` }),
    })
    if (!signed) return yield* new CrlInvalid({ reason: "not signed by the pki-client CA" })
    const nextUpdate = crl.nextUpdate
    if (!nextUpdate) return yield* new CrlInvalid({ reason: "no nextUpdate" })
    if (nextUpdate.getTime() < nowMs + MIN_CRL_VALIDITY_MS) {
      return yield* new CrlInvalid({ reason: `nextUpdate ${nextUpdate.toISOString()} is under 3 days away` })
    }
    return { pem: crlPem, nextUpdate, serials: new Set(crl.entries.map((e) => canonicalSerial(e.serialNumber))) }
  })

// --- publisher state, shared with the worker's /metrics ---

/** What KV holds, as far as this process knows. */
export type KnownPublished =
  | { readonly _tag: "Unread" }
  | { readonly _tag: "Read"; readonly pem: Option.Option<string> }

/** Facts about the last cycle whose CRL validated. */
export interface LastGoodCycle {
  readonly nextUpdateSeconds: number
  /** End of the cycle, epoch seconds (written or unchanged). */
  readonly publishedSeconds: number
  /** Completed serials still missing from the CRL after re-revoking. */
  readonly missingSerials: number
}

export interface CrlPublisherState {
  /** Watermark seen when the last cycle started; a different one triggers a cycle. */
  readonly watermark: Option.Option<string>
  readonly published: KnownPublished
  /** Epoch ms at which the next cycle runs even with no revocation. */
  readonly nextCycleAtMs: number
  readonly lastGood: Option.Option<LastGoodCycle>
  /** Where the next re-revoke batch starts in the missing list, so no serial is starved. */
  readonly rerevokeOffset: number
}

export const initialCrlPublisherState: CrlPublisherState = {
  watermark: Option.none(),
  published: { _tag: "Unread" },
  nextCycleAtMs: 0,
  lastGood: Option.none(),
  rerevokeOffset: 0,
}

type CycleError = CrlSourceError | CrlInvalid | CrlDbError | CrlCycleTimeout

const fetchValidated = Effect.gen(function* () {
  const vault = yield* VaultCrl
  yield* vault.rotateCrl
  const [crlPem, caPem] = yield* Effect.all([vault.getCrlPem, vault.getCaPem])
  return yield* validateCrl(crlPem, caPem, yield* Clock.currentTimeMillis)
})

const missingFrom = (crl: ValidatedCrl, serials: ReadonlyArray<string>) =>
  serials.filter((serial) => !crl.serials.has(canonicalSerial(serial)))

/** Up to `MAX_REREVOKES_PER_CYCLE` serials from `offset`, wrapping, so every missing serial gets its turn. */
export const rerevokeBatch = (missing: ReadonlyArray<string>, offset: number): ReadonlyArray<string> => {
  if (missing.length <= MAX_REREVOKES_PER_CYCLE) return missing
  const start = offset % missing.length
  return [...missing.slice(start), ...missing.slice(0, start)].slice(0, MAX_REREVOKES_PER_CYCLE)
}

/**
 * One publication: rotate, fetch, validate, reconcile with the DB, write to KV
 * when the content changed. Fails without writing on any invalid CRL.
 */
export const publishCycle = (
  state: Ref.Ref<CrlPublisherState>,
): Effect.Effect<void, Exclude<CycleError, CrlCycleTimeout>, VaultCrl | CertManager | CrlDb> =>
  Effect.gen(function* () {
    const vault = yield* VaultCrl
    const certManager = yield* CertManager
    const db = yield* CrlDb

    let crl = yield* fetchValidated

    // Reconcile: every revocation duro completed must be on the CRL.
    const completed = yield* db.completedUnexpiredSerials
    const missing = missingFrom(crl, completed)
    if (missing.length > 0) {
      const batch = rerevokeBatch(missing, (yield* Ref.get(state)).rerevokeOffset)
      yield* Effect.logWarning("crl: completed revocations missing from the CRL, revoking again").pipe(
        Effect.annotateLogs({ missing: missing.length, serials: batch.join(",") }),
      )
      // Advanced before revoking: a cycle that dies mid-batch still moves on to
      // the next serials instead of retrying the same ones.
      yield* Ref.update(state, (current) => ({ ...current, rerevokeOffset: current.rerevokeOffset + batch.length }))
      yield* Effect.forEach(
        batch,
        (serial) =>
          certManager.revokeCert(serial).pipe(
            Effect.timeoutFail({
              duration: REREVOKE_TIMEOUT,
              onTimeout: () => ({ message: `timed out after ${REREVOKE_TIMEOUT}` }),
            }),
            Effect.tapError((e: CertManagerError | { readonly message: string }) =>
              Effect.logError("crl: re-revoke failed").pipe(Effect.annotateLogs({ serial, error: e.message })),
            ),
            Effect.either,
          ),
        { discard: true },
      )
      crl = yield* fetchValidated
    }
    const stillMissing = missingFrom(crl, completed).length

    const known = (yield* Ref.get(state)).published
    const published = known._tag === "Read" ? known.pem : yield* vault.readPublishedCrl
    if (!Option.contains(published, crl.pem)) {
      yield* vault.writePublishedCrl(crl.pem)
      yield* Effect.log("crl: published").pipe(
        Effect.annotateLogs({ nextUpdate: crl.nextUpdate.toISOString(), revoked: crl.serials.size }),
      )
    }
    const nowMs = yield* Clock.currentTimeMillis
    yield* Ref.update(
      state,
      (current): CrlPublisherState => ({
        ...current,
        published: { _tag: "Read", pem: Option.some(crl.pem) },
        lastGood: Option.some({
          nextUpdateSeconds: Math.floor(crl.nextUpdate.getTime() / 1000),
          publishedSeconds: Math.floor(nowMs / 1000),
          missingSerials: stillMissing,
        }),
      }),
    )
  }).pipe(Effect.withSpan("crlPublishCycle"))

/**
 * One 30 s tick: runs a cycle when a revocation completed since the last one,
 * or when the next scheduled cycle is due (immediately at start). Never fails:
 * a failed or timed-out cycle is logged and retried after
 * `RETRY_AFTER_FAILURE_MS`. Resolves whether a cycle ran.
 */
export const publisherTick = (
  state: Ref.Ref<CrlPublisherState>,
): Effect.Effect<boolean, never, VaultCrl | CertManager | CrlDb> =>
  Effect.gen(function* () {
    const db = yield* CrlDb
    const watermark = yield* db.revocationWatermark.pipe(
      Effect.timeoutFail({
        duration: "10 seconds",
        onTimeout: () => new CrlDbError({ operation: "watermark", cause: "timed out" }),
      }),
      Effect.tapError((e) =>
        Effect.logError("crl: watermark query failed").pipe(Effect.annotateLogs({ cause: String(e.cause) })),
      ),
      Effect.option,
    )
    const current = yield* Ref.get(state)
    const nowMs = yield* Clock.currentTimeMillis
    const revoked = Option.isSome(watermark) && !Option.contains(current.watermark, watermark.value)
    if (!revoked && nowMs < current.nextCycleAtMs) return false

    // The watermark is taken before the cycle: a revocation landing during it
    // moves the watermark again and triggers the next tick.
    const seen = Option.orElse(watermark, () => current.watermark)
    const ok = yield* publishCycle(state).pipe(
      Effect.timeoutFail({ duration: CYCLE_DEADLINE, onTimeout: () => new CrlCycleTimeout({ after: CYCLE_DEADLINE }) }),
      Effect.as(true),
      // A defect fails the cycle like an error; an interruption (worker
      // shutdown) is not a failure and propagates.
      Effect.catchAllCause((cause: Cause.Cause<CycleError>) =>
        Cause.isInterruptedOnly(cause)
          ? Effect.interrupt
          : Effect.logError("crl: publish failed").pipe(
              Effect.annotateLogs({ cause: Cause.pretty(cause) }),
              Effect.as(false),
            ),
      ),
    )
    const after = yield* Clock.currentTimeMillis
    yield* Ref.update(state, (latest) => ({
      ...latest,
      watermark: seen,
      nextCycleAtMs: after + (ok ? PUBLISH_EVERY_MS : RETRY_AFTER_FAILURE_MS),
    }))
    return true
  })

/** The publisher loop: a tick at start, then every `TICK_EVERY`, forever. */
export const crlPublisherLoop = (state: Ref.Ref<CrlPublisherState>) =>
  publisherTick(state).pipe(Effect.repeat(Schedule.spaced(TICK_EVERY)), Effect.asVoid)

// --- what /metrics shows ---

export interface CrlMetricsSnapshot {
  readonly lastGood: Option.Option<LastGoodCycle>
  readonly pendingRevocations: number
}

export const crlMetricsSnapshot = (
  state: Ref.Ref<CrlPublisherState>,
): Effect.Effect<CrlMetricsSnapshot, CrlDbError, CrlDb> =>
  Effect.gen(function* () {
    const db = yield* CrlDb
    return { lastGood: (yield* Ref.get(state)).lastGood, pendingRevocations: yield* db.pendingRevocations }
  })
