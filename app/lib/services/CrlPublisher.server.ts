/**
 * Publishes the `pki-client` CRL for Envoy (plan 2026-11-25, Phase 2).
 *
 * duro-worker rebuilds Vault's CRL, checks it, and writes it to NAS Vault KV
 * `secret/pki/client-crl` (key `ca.crl`); the homelab broker copies it to the
 * main Vault and ESO hands it to Envoy Gateway. It publishes at start (the
 * runbook's force-publish is a worker restart), every 6 h, and within a 30 s
 * tick of a revocation completing: revocations complete in the web pods, so
 * the worker watches `max(revoked_at)` in the DB.
 */
// tsyringe, which @peculiar/x509 loads, throws at import without this polyfill.
import "reflect-metadata"
import * as x509 from "@peculiar/x509"
import { Clock, Context, Data, Effect, Layer, Ref, Schedule } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { VaultCrl, VaultPki, type VaultPkiError } from "~/lib/services/VaultPki.server"

const DAY_MS = 86_400_000
/** A CRL that expires sooner than this is refused: Envoy would soon refuse every client. */
export const MIN_CRL_VALIDITY_MS = 3 * DAY_MS
export const PUBLISH_EVERY_MS = 6 * 3_600_000
/** After a failed cycle, the next attempt waits this long (a down Vault is not hammered). */
export const RETRY_AFTER_FAILURE_MS = 5 * 60_000
export const TICK_EVERY = "30 seconds"
/** Re-revocations per cycle: a serial Vault keeps leaving out must not loop. */
export const MAX_REREVOKES_PER_CYCLE = 10

/** Colon hex as Vault and the DB store it, or bare hex from a CRL, compared alike. */
export const canonicalSerial = (serial: string): string => serial.replace(/:/g, "").toLowerCase().replace(/^0+/, "")

export class CrlInvalid extends Data.TaggedError("CrlInvalid")<{ readonly reason: string }> {}

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

// --- what the publisher reads from duro's DB ---

export class CrlDbError extends Data.TaggedError("CrlDbError")<{ readonly cause: unknown }> {}

export class CrlDb extends Context.Tag("CrlDb")<
  CrlDb,
  {
    /** `max(revoked_at)` as text; it changes when a revocation completes. */
    readonly revocationWatermark: Effect.Effect<string | null, CrlDbError>
    /** Serials revoked in Vault (`completed`) that have not expired: each must be on the CRL. */
    readonly completedUnexpiredSerials: Effect.Effect<ReadonlyArray<string>, CrlDbError>
    /** Revocations not yet done in Vault (`pending` or `failed`), unexpired. */
    readonly pendingRevocations: Effect.Effect<number, CrlDbError>
  }
>() {}

export const CrlDbLive = Layer.effect(
  CrlDb,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const wrap = <A, E, R>(e: Effect.Effect<A, E, R>) => Effect.mapError(e, (cause) => new CrlDbError({ cause }))
    return {
      revocationWatermark: wrap(
        sql<{ latest: string | null }>`SELECT max(revoked_at)::text AS latest FROM user_certificates`,
      ).pipe(Effect.map((rows) => rows[0]?.latest ?? null)),
      completedUnexpiredSerials: wrap(
        sql<{ serialNumber: string }>`SELECT serial_number FROM user_certificates
          WHERE revoke_state = 'completed' AND revoked_at IS NOT NULL AND expires_at > NOW()`,
      ).pipe(Effect.map((rows) => rows.map((r) => r.serialNumber))),
      pendingRevocations: wrap(
        sql<{ n: string | number }>`SELECT count(*) AS n FROM user_certificates
          WHERE revoke_state IN ('pending', 'failed') AND revoked_at IS NULL AND expires_at > NOW()`,
      ).pipe(Effect.map((rows) => Number(rows[0]?.n ?? 0))),
    }
  }),
)

// --- publisher state, shared with the worker's /metrics ---

export interface CrlPublisherState {
  /** Watermark seen when the last cycle started; a different one triggers a cycle. */
  readonly watermark: string | null
  /** What KV holds, as far as this process knows; undefined until read once. */
  readonly publishedPem: string | null | undefined
  /** Epoch ms at which the next cycle runs even with no revocation. */
  readonly nextCycleAtMs: number
  /** Last validated CRL's nextUpdate, epoch seconds; null before the first good cycle. */
  readonly nextUpdateSeconds: number | null
  /** End of the last cycle whose CRL validated, epoch seconds (written or unchanged). */
  readonly publishedSeconds: number | null
  /** Completed serials missing from the last validated CRL. */
  readonly missingSerials: number | null
}

export const initialCrlPublisherState: CrlPublisherState = {
  watermark: null,
  publishedPem: undefined,
  nextCycleAtMs: 0,
  nextUpdateSeconds: null,
  publishedSeconds: null,
  missingSerials: null,
}

type CycleError = VaultPkiError | CrlInvalid | CrlDbError

const fetchValidated = Effect.gen(function* () {
  const vault = yield* VaultCrl
  yield* vault.rotateCrl
  const [crlPem, caPem] = yield* Effect.all([vault.getCrlPem, vault.getCaPem])
  return yield* validateCrl(crlPem, caPem, yield* Clock.currentTimeMillis)
})

const missingFrom = (crl: ValidatedCrl, serials: ReadonlyArray<string>) =>
  serials.filter((s) => !crl.serials.has(canonicalSerial(s)))

/**
 * One publication: rotate, fetch, validate, reconcile with the DB, write to KV
 * when the content changed. Fails without writing on any invalid CRL.
 */
export const publishCycle = (
  state: Ref.Ref<CrlPublisherState>,
): Effect.Effect<void, CycleError, VaultCrl | VaultPki | CrlDb> =>
  Effect.gen(function* () {
    const vault = yield* VaultCrl
    const pki = yield* VaultPki
    const db = yield* CrlDb

    let crl = yield* fetchValidated

    // Reconcile: every revocation duro completed must be on the CRL.
    const completed = yield* db.completedUnexpiredSerials
    const missing = missingFrom(crl, completed)
    if (missing.length > 0) {
      yield* Effect.logWarning("crl: completed revocations missing from the CRL, revoking again").pipe(
        Effect.annotateLogs({ missing: missing.length, serials: missing.slice(0, MAX_REREVOKES_PER_CYCLE).join(",") }),
      )
      yield* Effect.forEach(
        missing.slice(0, MAX_REREVOKES_PER_CYCLE),
        (serial) =>
          pki.revokeCert(serial).pipe(
            Effect.tapError((e) =>
              Effect.logError("crl: re-revoke failed").pipe(Effect.annotateLogs({ serial, error: e.message })),
            ),
            Effect.either,
          ),
        { discard: true },
      )
      crl = yield* fetchValidated
    }
    const stillMissing = missingFrom(crl, completed).length

    const known = (yield* Ref.get(state)).publishedPem
    const published = known === undefined ? yield* vault.readPublishedCrl : known
    if (published !== crl.pem) {
      yield* vault.writePublishedCrl(crl.pem)
      yield* Effect.log("crl: published").pipe(
        Effect.annotateLogs({ nextUpdate: crl.nextUpdate.toISOString(), revoked: crl.serials.size }),
      )
    }
    const nowMs = yield* Clock.currentTimeMillis
    yield* Ref.update(state, (s) => ({
      ...s,
      publishedPem: crl.pem,
      nextUpdateSeconds: Math.floor(crl.nextUpdate.getTime() / 1000),
      publishedSeconds: Math.floor(nowMs / 1000),
      missingSerials: stillMissing,
    }))
  }).pipe(Effect.withSpan("crlPublishCycle"))

/**
 * One 30 s tick: runs a cycle when a revocation completed since the last one,
 * or when the next scheduled cycle is due (immediately at start). Never fails:
 * a failed cycle is logged and retried after `RETRY_AFTER_FAILURE_MS`.
 * Resolves whether a cycle ran.
 */
export const publisherTick = (
  state: Ref.Ref<CrlPublisherState>,
): Effect.Effect<boolean, never, VaultCrl | VaultPki | CrlDb> =>
  Effect.gen(function* () {
    const db = yield* CrlDb
    const watermark = yield* db.revocationWatermark.pipe(
      Effect.tapError((e) =>
        Effect.logError("crl: watermark query failed").pipe(Effect.annotateLogs({ cause: String(e.cause) })),
      ),
      Effect.option,
    )
    const s = yield* Ref.get(state)
    const nowMs = yield* Clock.currentTimeMillis
    const revoked = watermark._tag === "Some" && watermark.value !== s.watermark
    if (!revoked && nowMs < s.nextCycleAtMs) return false

    // The watermark is taken before the cycle: a revocation landing during it
    // moves the watermark again and triggers the next tick.
    const seen = watermark._tag === "Some" ? watermark.value : s.watermark
    const ok = yield* publishCycle(state).pipe(
      Effect.as(true),
      Effect.catchAllCause((cause) =>
        Effect.logError("crl: publish failed").pipe(Effect.annotateLogs({ cause: String(cause) }), Effect.as(false)),
      ),
    )
    const after = yield* Clock.currentTimeMillis
    yield* Ref.update(state, (cur) => ({
      ...cur,
      watermark: seen,
      nextCycleAtMs: after + (ok ? PUBLISH_EVERY_MS : RETRY_AFTER_FAILURE_MS),
    }))
    return true
  })

/** The publisher loop: a tick at start, then every `TICK_EVERY`, forever. */
export const crlPublisherLoop = (state: Ref.Ref<CrlPublisherState>) =>
  publisherTick(state).pipe(Effect.repeat(Schedule.spaced(TICK_EVERY)), Effect.asVoid)

// --- Prometheus text exposition ---

const gauge = (name: string, help: string, value: number) =>
  `# HELP ${name} ${help}\n# TYPE ${name} gauge\n${name} ${value}\n`

/**
 * The four CRL gauges. The two timestamps are omitted until the first good
 * cycle: a 0 would read as "expired" and fire the staleness alerts at every
 * restart. The DB-backed counts are always present.
 */
export const renderCrlMetrics = (state: Ref.Ref<CrlPublisherState>): Effect.Effect<string, CrlDbError, CrlDb> =>
  Effect.gen(function* () {
    const db = yield* CrlDb
    const s = yield* Ref.get(state)
    const pending = yield* db.pendingRevocations
    const missing = s.missingSerials ?? 0
    return [
      s.nextUpdateSeconds !== null
        ? gauge("duro_crl_next_update_timestamp_seconds", "nextUpdate of the last published CRL.", s.nextUpdateSeconds)
        : "",
      s.publishedSeconds !== null
        ? gauge(
            "duro_crl_published_timestamp_seconds",
            "When the last validated CRL was published (written or unchanged).",
            s.publishedSeconds,
          )
        : "",
      gauge("duro_crl_missing_serials", "Completed revocations missing from the published CRL.", missing),
      gauge("duro_revocations_pending", "Revocations not yet done in Vault (pending or failed).", pending),
    ].join("")
  })
