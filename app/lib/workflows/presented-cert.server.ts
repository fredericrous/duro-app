import { Cause, Duration, Effect, Fiber, Option, Ref } from "effect"
import { canonicalSerial, parseXfccCert } from "~/lib/client-cert.server"
import { ClientCaTrust } from "~/lib/services/ClientCaTrust.server"
import { CertificateRepo } from "~/lib/services/CertificateRepo.server"

/**
 * Is the client certificate this request's device presented one of the
 * signed-in user's own certificates that duro has revoked?
 *
 * `home.daddyshome.fr` (listener duro-https) has no CRL, by design: it is the
 * way back in once the gateway enforces revocation everywhere else. So a
 * revoked certificate still reaches duro there, and duro can point its owner
 * to the devices page instead of leaving them on a page that half works.
 *
 * Read-only, and never fails, defects included: anything it cannot prove is
 * "no" (home awaits it before streaming, so a throw here would be a 500). The checks
 * run cheapest first, so the common request (a valid cert) costs one parse
 * and one indexed query; the CA check (`ClientCaTrust`, which may refresh
 * from Vault) runs only for a revoked hit.
 *
 * Plan: docs/plans/2026-11-26-revoked-cert-notice.md.
 */
export interface PresentedRevokedCert {
  readonly serial: string
  readonly revokedAt: string
  readonly label: string | null
}

/** The plain shape loader data carries (no Option across the wire). */
export interface PresentedRevokedNotice {
  readonly revokedAt: string
  readonly label: string | null
}

/** Budget for the whole check: home waits for it before it starts streaming. */
export const PRESENTED_CERT_TIMEOUT = Duration.millis(300)

export const presentedRevokedCert = (
  xfcc: string | null | undefined,
  username: string | null | undefined,
): Effect.Effect<Option.Option<PresentedRevokedCert>, never, CertificateRepo | ClientCaTrust> =>
  Effect.gen(function* () {
    if (!username) return Option.none()
    const parsed = parseXfccCert(xfcc)
    if (!parsed) return Option.none()
    const serial = canonicalSerial(parsed.serial)

    const step = yield* Ref.make("certificate lookup")
    const check = Effect.gen(function* () {
      const certRepo = yield* CertificateRepo
      const cert = yield* certRepo.findBySerialCanonical(serial)
      // Never reveal another user's certificate, nor an unrevoked one.
      if (!cert || cert.username !== username || cert.revokedAt === null) {
        return Option.none<PresentedRevokedCert>()
      }
      // A serial is unique only within one issuer, and this listener also
      // trusts the break-glass root: prove pki-client signed it, last.
      // In a daemon fiber, so a request that times out does not cancel the CA
      // refresh: interrupting the join leaves the fiber running, and it fills
      // the cache for the next check (Effect.disconnect would still interrupt
      // it, only without waiting). ClientCaTrustLive bounds the fetch to 5 s.
      yield* Ref.set(step, "client CA check")
      const trust = yield* ClientCaTrust
      const caCheck = yield* Effect.forkDaemon(trust.isIssuedByClientCa(parsed.pem))
      const issuedByClientCa = yield* Fiber.join(caCheck)
      if (!issuedByClientCa) return Option.none<PresentedRevokedCert>()
      // The driver hands timestamptz back as a Date despite the row's string
      // type: normalise, so loader data and the notice see one ISO string.
      const revokedAt = new Date(cert.revokedAt).toISOString()
      return Option.some<PresentedRevokedCert>({ serial, revokedAt, label: cert.label })
    }).pipe(
      // Every cause, defects included: a bad row or a dying dependency must
      // cost the notice, never the home page.
      Effect.catchAllCause((cause) =>
        Effect.logWarning("presented-cert: certificate lookup failed; no revoked-cert notice", {
          cause: Cause.pretty(cause),
        }).pipe(Effect.as(Option.none<PresentedRevokedCert>())),
      ),
    )

    const outcome = yield* check.pipe(Effect.timeoutOption(PRESENTED_CERT_TIMEOUT))
    if (Option.isNone(outcome)) {
      const where = yield* Ref.get(step)
      yield* Effect.logWarning(
        `presented-cert: ${where} timed out after ${Duration.format(PRESENTED_CERT_TIMEOUT)}; no revoked-cert notice`,
      )
      return Option.none()
    }
    const hit = outcome.value
    if (Option.isSome(hit)) {
      yield* Effect.logInfo("presented-cert: the device presented a revoked certificate of its user", {
        serial: hit.value.serial,
      })
    }
    return hit
  })

/** `presentedRevokedCert` in the plain shape loader data carries. */
export const presentedRevokedNotice = (xfcc: string | null | undefined, username: string | null | undefined) =>
  presentedRevokedCert(xfcc, username).pipe(
    Effect.map(
      Option.match({
        onNone: (): PresentedRevokedNotice | null => null,
        onSome: (hit): PresentedRevokedNotice | null => ({ revokedAt: hit.revokedAt, label: hit.label }),
      }),
    ),
  )
