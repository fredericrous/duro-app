import { Effect } from "effect"
import { CertificateRepo } from "~/lib/services/CertificateRepo.server"
import { deviceBudgetFrom, NEW_DEVICE_WINDOW_MS, type DeviceBudget } from "~/lib/device-budget"

/**
 * The account's current new-device budget, read straight off the certificates
 * that occupy it. See ~/lib/device-budget for why the ledger IS the cert list.
 */
export const deviceBudget = (username: string): Effect.Effect<DeviceBudget, never, CertificateRepo> =>
  Effect.gen(function* () {
    const certRepo = yield* CertificateRepo
    const since = new Date(Date.now() - NEW_DEVICE_WINDOW_MS)
    const recent = yield* certRepo.listRecentNewDevices(username, since)
    return deviceBudgetFrom(recent.map((c) => c.issuedAt))
  }).pipe(
    // A bookkeeping failure must not become a lockout: fall back to "no slots
    // used" so the server-side issue path still runs its own checks.
    Effect.catchAll(() => Effect.succeed(deviceBudgetFrom([]))),
  )
