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
 * Read-only, and never fails, defects included (every page waits for it, so a
 * throw here would be a 500): what it cannot tell is `Unavailable` or
 * `Unproven`, which callers treat by what is at stake. The checks run cheapest first, so the common request (a valid cert) costs one parse
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

/** Budget for the check on a page load: every request waits for it. */
export const PRESENTED_CERT_TIMEOUT = Duration.millis(300)

/**
 * What duro knows about the certificate a request's device presented.
 * Absent and "not revoked" are different from "could not tell": the notice
 * and the page confinement fail soft on Unavailable (a slow query must not
 * lock everyone out), the email-only rule fails closed on it (a lost device
 * must not get a link on screen because a lookup timed out).
 */
export type PresentedCertStatus =
  /** One of the user's own certificates, revoked, and proven pki-client's. */
  | { readonly _tag: "Revoked"; readonly cert: PresentedRevokedCert }
  /** No certificate, another user's, unknown, unrevoked, or not pki-client's. */
  | { readonly _tag: "NotRevoked" }
  /** A revoked row of this user's matched, but the client CA check did not
   *  answer in time: treated as revoked (the safe side). */
  | { readonly _tag: "Unproven" }
  /** The lookup itself failed or ran out of time: nothing is known. */
  | { readonly _tag: "Unavailable" }

/** Restricted: duro treats the device as presenting a revoked certificate. */
export const isRestricted = (status: PresentedCertStatus): boolean =>
  status._tag === "Revoked" || status._tag === "Unproven"

/** Links by email only: restricted, or not even known (fail closed). */
export const emailOnly = (status: PresentedCertStatus): boolean => status._tag !== "NotRevoked"

export const presentedCertStatus = (
  xfcc: string | null | undefined,
  username: string | null | undefined,
  options: { readonly timeout?: Duration.DurationInput } = {},
): Effect.Effect<PresentedCertStatus, never, CertificateRepo | ClientCaTrust> =>
  Effect.gen(function* () {
    const parsed = parseXfccCert(xfcc)
    if (!username || !parsed) return { _tag: "NotRevoked" } as const
    const serial = canonicalSerial(parsed.serial)
    const timeout = options.timeout ?? PRESENTED_CERT_TIMEOUT

    const step = yield* Ref.make<"certificate lookup" | "client CA check">("certificate lookup")
    const check = Effect.gen(function* () {
      const certRepo = yield* CertificateRepo
      const cert = yield* certRepo.findBySerialCanonical(serial)
      // Never reveal another user's certificate, nor an unrevoked one.
      if (!cert || cert.username !== username || cert.revokedAt === null) {
        return { _tag: "NotRevoked" } as PresentedCertStatus
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
      if (!issuedByClientCa) return { _tag: "NotRevoked" } as PresentedCertStatus
      // The driver hands timestamptz back as a Date despite the row's string
      // type: normalise, so loader data and the notice see one ISO string.
      const revokedAt = new Date(cert.revokedAt).toISOString()
      return { _tag: "Revoked", cert: { serial, revokedAt, label: cert.label } } as PresentedCertStatus
    }).pipe(
      // Every cause, defects included: a bad row or a dying dependency must
      // cost the notice, never the page.
      Effect.catchAllCause((cause) =>
        Effect.logWarning("presented-cert: certificate lookup failed; its status is unknown", {
          cause: Cause.pretty(cause),
        }).pipe(Effect.as({ _tag: "Unavailable" } as PresentedCertStatus)),
      ),
    )

    const outcome = yield* check.pipe(Effect.timeoutOption(timeout))
    if (Option.isNone(outcome)) {
      const where = yield* Ref.get(step)
      yield* Effect.logWarning(`presented-cert: ${where} timed out after ${Duration.format(Duration.decode(timeout))}`)
      return { _tag: where === "client CA check" ? "Unproven" : "Unavailable" } as PresentedCertStatus
    }
    const status = outcome.value
    if (status._tag === "Revoked") {
      yield* Effect.logInfo("presented-cert: the device presented a revoked certificate of its user", {
        serial: status.cert.serial,
      })
    }
    return status
  })

/** The revoked certificate this device presented, if proven: for the notice. */
export const presentedRevokedCert = (xfcc: string | null | undefined, username: string | null | undefined) =>
  presentedCertStatus(xfcc, username).pipe(
    Effect.map((status) =>
      status._tag === "Revoked" ? Option.some(status.cert) : Option.none<PresentedRevokedCert>(),
    ),
  )

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
