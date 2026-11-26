import { Effect } from "effect"
import { CertificateRepo } from "~/lib/services/CertificateRepo.server"
import { revokeSerialForUser } from "~/lib/workflows/cert-revocation.server"

const SWEEP_BATCH = 25
const SWEEPER_ACTOR = "system:revocation-sweeper"

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
