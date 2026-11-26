import { Config, Effect, Layer, Option, Redacted, Schema } from "effect"
import * as HttpClient from "@effect/platform/HttpClient"
import * as HttpClientRequest from "@effect/platform/HttpClientRequest"
import { makeJsonApi } from "~/lib/http.server"
import { CrlSourceError, VaultCrl } from "~/lib/services/CrlPublisher.server"
import { VaultPkiError } from "~/lib/services/VaultPki.server"

// --- CRL publication: the adapter for CrlPublisher's VaultCrl port ---

const VaultCaCertResponse = Schema.Struct({ data: Schema.Struct({ certificate: Schema.String }) })
const VaultPublishedCrl = Schema.Struct({
  data: Schema.Struct({ data: Schema.Struct({ "ca.crl": Schema.optional(Schema.String) }) }),
})
const decodeCaCert = Schema.decodeUnknown(VaultCaCertResponse)
const decodePublishedCrl = Schema.decodeUnknown(VaultPublishedCrl)

/** The KV v2 path Phase 3's broker copies to main Vault for Envoy. */
export const PUBLISHED_CRL_PATH = "/secret/data/pki/client-crl"

/** Each Vault call gives up after this; the fetch client sets no deadline of its own. */
export const VAULT_CALL_TIMEOUT = "15 seconds"

/**
 * NAS Vault behind the `VaultCrl` port: `GET pki-client/crl/rotate`,
 * `crl/pem`, `cert/ca`, and KV `secret/pki/client-crl`. The `duro-pki` policy
 * grants exactly these paths.
 */
export const VaultCrlLive = Layer.effect(
  VaultCrl,
  Effect.gen(function* () {
    const vaultAddr = yield* Config.string("NAS_VAULT_ADDR")
    const vaultToken = Redacted.value(yield* Config.redacted("NAS_VAULT_TOKEN"))
    const http = yield* HttpClient.HttpClient
    const headers = { "X-Vault-Token": vaultToken, "Content-Type": "application/json" }
    const vault = makeJsonApi(
      http,
      `${vaultAddr}/v1`,
      headers,
      (e, status) => new VaultPkiError({ message: `Vault request failed: ${e}`, status }),
    )

    /** Bounds the call and names it: every failure leaves as a CrlSourceError. */
    const call =
      (operation: string) =>
      <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, CrlSourceError> =>
        effect.pipe(
          Effect.timeoutFail({
            duration: VAULT_CALL_TIMEOUT,
            onTimeout: () => new CrlSourceError({ operation, message: `timed out after ${VAULT_CALL_TIMEOUT}` }),
          }),
          Effect.mapError((e) =>
            e instanceof CrlSourceError
              ? e
              : new CrlSourceError({
                  operation,
                  message: e instanceof VaultPkiError ? e.message : String(e),
                  status: e instanceof VaultPkiError ? e.status : undefined,
                }),
          ),
        )

    // crl/pem answers PEM text, not JSON, so it bypasses makeJsonApi.
    const getText = (path: string) =>
      http.execute(HttpClientRequest.get(`${vaultAddr}/v1${path}`).pipe(HttpClientRequest.setHeaders(headers))).pipe(
        Effect.flatMap((response) =>
          response.text.pipe(
            Effect.flatMap((body) =>
              response.status >= 200 && response.status < 300
                ? Effect.succeed(body)
                : Effect.fail(
                    new VaultPkiError({
                      message: `GET ${path}: ${response.status} - ${body.slice(0, 500)}`,
                      status: response.status,
                    }),
                  ),
            ),
          ),
        ),
        Effect.scoped,
      )

    return {
      rotateCrl: call("rotate")(vault.get(`/pki-client/crl/rotate`).pipe(Effect.asVoid)),
      getCrlPem: call("crl/pem")(getText(`/pki-client/crl/pem`)),
      getCaPem: call("cert/ca")(
        vault.get(`/pki-client/cert/ca`).pipe(
          Effect.flatMap(decodeCaCert),
          Effect.map((response) => response.data.certificate),
        ),
      ),
      readPublishedCrl: call("read client-crl")(
        vault.get(PUBLISHED_CRL_PATH).pipe(
          Effect.flatMap(decodePublishedCrl),
          Effect.map((response) => Option.fromNullable(response.data.data["ca.crl"])),
          Effect.catchIf(
            (e): e is VaultPkiError => e instanceof VaultPkiError && e.status === 404,
            () => Effect.succeed(Option.none<string>()),
          ),
        ),
      ),
      writePublishedCrl: (pem: string) =>
        call("write client-crl")(vault.post(PUBLISHED_CRL_PATH, { data: { "ca.crl": pem } }).pipe(Effect.asVoid)),
    }
  }),
)
