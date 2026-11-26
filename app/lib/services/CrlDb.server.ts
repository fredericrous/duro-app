/**
 * The SQL adapter for the CRL publisher's `CrlDb` port. Its predicates are the
 * ones `CertificateRepo` uses for revocation state: a revocation is done in
 * Vault when `revoke_state = 'completed'` and `revoked_at` is set, still owed
 * when it is `pending`/`failed` with `revoked_at IS NULL`, and only an
 * unexpired cert (`expires_at > NOW()`) matters to Envoy.
 */
import { Effect, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { CrlDb, CrlDbError } from "~/lib/services/CrlPublisher.server"

export const CrlDbLive = Layer.effect(
  CrlDb,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const named =
      (operation: CrlDbError["operation"]) =>
      <A, E, R>(query: Effect.Effect<A, E, R>) =>
        Effect.mapError(query, (cause) => new CrlDbError({ operation, cause }))
    return {
      // revoked_at is the completing statement's start time, not its commit
      // time: two completions committing out of order can leave max() still.
      // The count still moves, so the pair is a watermark nothing slips past.
      revocationWatermark: named("watermark")(
        sql<{ watermark: string }>`SELECT
            count(*) FILTER (WHERE revoke_state = 'completed')::text || '|' ||
            COALESCE(max(revoked_at)::text, '') AS watermark
          FROM user_certificates`,
      ).pipe(Effect.map((rows) => rows[0]?.watermark ?? "")),
      completedUnexpiredSerials: named("completedSerials")(
        sql<{ serialNumber: string }>`SELECT serial_number FROM user_certificates
          WHERE revoke_state = 'completed' AND revoked_at IS NOT NULL AND expires_at > NOW()`,
      ).pipe(Effect.map((rows) => rows.map((row) => row.serialNumber))),
      pendingRevocations: named("pendingCount")(
        sql<{ pending: string | number }>`SELECT count(*) AS pending FROM user_certificates
          WHERE revoke_state IN ('pending', 'failed') AND revoked_at IS NULL AND expires_at > NOW()`,
      ).pipe(Effect.map((rows) => Number(rows[0]?.pending ?? 0))),
    }
  }),
)
