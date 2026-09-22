import { Clock, Config, Context, Duration, Effect, Layer, Ref } from "effect"
import { HttpClient, HttpClientRequest } from "@effect/platform"
import { isIssuedBy } from "~/lib/client-cert.server"

/**
 * Which CA issued a client certificate that Envoy already accepted.
 *
 * `home.daddyshome.fr` trusts more than one root: the NAS Vault `pki-client`
 * CA that issues every user certificate, and the break-glass CA whose 2-hour
 * certificates exist only to reach this app's login. Invite resolution keys on
 * a certificate serial, which is unique only within one issuer, so a
 * certificate must be proven to come from `pki-client` before its serial is
 * looked up. The check is cryptographic (`isIssuedBy`), never a name match.
 */
export class ClientCaTrust extends Context.Tag("ClientCaTrust")<
  ClientCaTrust,
  {
    /**
     * True only when `certPem` was signed by the `pki-client` root. Never
     * fails: a CA that cannot be obtained means "not proven", and callers
     * treat that as an unresolvable certificate (they fall through to the
     * OIDC login), which is the safe direction.
     */
    readonly isIssuedByClientCa: (certPem: string) => Effect.Effect<boolean>
  }
>() {}

/** How long a fetched CA is used before it is fetched again. */
const CA_TTL = Duration.hours(1)

/**
 * Reads the CA from NAS Vault's `pki-client/cert/ca`, an unauthenticated PKI
 * endpoint, and caches it. A failed refresh keeps serving the last good CA —
 * the root is a 10-year certificate, and an outage should not turn every
 * pending invitee away — but with nothing cached it fails closed.
 */
export const ClientCaTrustLive = Layer.effect(
  ClientCaTrust,
  Effect.gen(function* () {
    const vaultAddr = yield* Config.string("NAS_VAULT_ADDR")
    const http = yield* HttpClient.HttpClient
    const cache = yield* Ref.make<{ pem: string; fetchedAt: number } | null>(null)

    const fetchCaPem = Effect.gen(function* () {
      const response = yield* http.execute(HttpClientRequest.get(`${vaultAddr}/v1/pki-client/cert/ca`))
      if (response.status !== 200) {
        return yield* Effect.fail(new Error(`pki-client/cert/ca answered ${response.status}`))
      }
      const body = (yield* response.json) as { data?: { certificate?: unknown } }
      const pem = body.data?.certificate
      if (typeof pem !== "string" || !pem.includes("BEGIN CERTIFICATE")) {
        return yield* Effect.fail(new Error("pki-client/cert/ca returned no certificate"))
      }
      return pem
    }).pipe(Effect.scoped)

    const currentCaPem: Effect.Effect<string | null> = Effect.gen(function* () {
      const cached = yield* Ref.get(cache)
      const now = yield* Clock.currentTimeMillis
      if (cached && now - cached.fetchedAt < Duration.toMillis(CA_TTL)) return cached.pem
      return yield* fetchCaPem.pipe(
        Effect.tap((pem) => Ref.set(cache, { pem, fetchedAt: now })),
        Effect.catchAll((error) =>
          Effect.logWarning("Could not fetch the pki-client CA; using the cached copy if any", {
            error: String(error),
            cached: cached !== null,
          }).pipe(Effect.as(cached?.pem ?? null)),
        ),
      )
    })

    return {
      isIssuedByClientCa: (certPem) =>
        currentCaPem.pipe(Effect.map((caPem) => (caPem === null ? false : isIssuedBy(certPem, caPem)))),
    }
  }),
)

/**
 * Dev server: there is no Vault and certificates come from `CertManagerDev`,
 * so every certificate is treated as client-CA issued — the same trust the
 * dev stack gives the rest of the cert flow.
 */
export const ClientCaTrustDev = Layer.succeed(ClientCaTrust, {
  isIssuedByClientCa: () => Effect.succeed(true),
})
