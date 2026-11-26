import { Context, Effect, Data, Layer, Config, Redacted, Schema, pipe } from "effect"
import { CertManager, CertManagerError } from "./CertManager.server"
import * as HttpClient from "@effect/platform/HttpClient"
import * as HttpClientRequest from "@effect/platform/HttpClientRequest"
import * as crypto from "node:crypto"
import forge from "node-forge"
import { makeJsonApi } from "~/lib/http.server"

export class VaultPkiError extends Data.TaggedError("VaultPkiError")<{
  readonly message: string
  readonly cause?: unknown
  /** HTTP status of the Vault response that caused this error, when there was one. */
  readonly status?: number
  /** True when retrying the same call cannot succeed (a Vault 4xx other than the idempotent cases). */
  readonly permanent?: boolean
}> {}

// 401 and 403 can clear when a token is renewed or a policy fixed; 408 and 429 say "try again later".
const TRANSIENT_CLIENT_STATUSES = new Set([401, 403, 408, 429])

const isPermanentStatus = (status: number | undefined): boolean =>
  status !== undefined && status >= 400 && status < 500 && !TRANSIENT_CLIENT_STATUSES.has(status)

// --- Vault response schemas ---

const VaultKvSecret = Schema.Struct({
  data: Schema.Struct({
    data: Schema.Struct({
      p12: Schema.optional(Schema.String),
      password: Schema.optional(Schema.String),
      email: Schema.optional(Schema.String),
      source: Schema.optional(Schema.String),
      serial_number: Schema.optional(Schema.String),
      not_after: Schema.optional(Schema.String),
    }),
  }),
})

const VaultCertIssueResponse = Schema.Struct({
  data: Schema.Struct({
    certificate: Schema.String,
    private_key: Schema.String,
    ca_chain: Schema.mutable(Schema.Array(Schema.String)),
    serial_number: Schema.String,
    not_after: Schema.optional(Schema.String),
  }),
})

const decodeKvSecret = Schema.decodeUnknown(VaultKvSecret)
const decodeCertIssue = Schema.decodeUnknown(VaultCertIssueResponse)

export class VaultPki extends Context.Tag("VaultPki")<
  VaultPki,
  {
    readonly issueCertAndP12: (
      email: string,
      inviteId: string,
    ) => Effect.Effect<{ p12Buffer: Buffer; password: string; serialNumber: string; notAfter: Date }, VaultPkiError>
    readonly getP12Password: (inviteId: string) => Effect.Effect<string | null, VaultPkiError>
    readonly getP12: (inviteId: string) => Effect.Effect<Buffer | null, VaultPkiError>
    readonly consumeP12Password: (inviteId: string) => Effect.Effect<string | null, VaultPkiError>
    readonly deleteP12Secret: (inviteId: string) => Effect.Effect<void, VaultPkiError>
    readonly checkCertProcessed: (username: string) => Effect.Effect<boolean, VaultPkiError>
    readonly deleteCertByUsername: (username: string) => Effect.Effect<void, VaultPkiError>
    readonly revokeCert: (serialNumber: string) => Effect.Effect<void, VaultPkiError>
  }
>() {}

export const VaultPkiLive = Layer.effect(
  VaultPki,
  Effect.gen(function* () {
    const vaultAddr = yield* Config.string("NAS_VAULT_ADDR")
    const vaultToken = Redacted.value(yield* Config.redacted("NAS_VAULT_TOKEN"))
    const http = yield* HttpClient.HttpClient

    const vault = makeJsonApi(
      http,
      `${vaultAddr}/v1`,
      {
        "X-Vault-Token": vaultToken,
        "Content-Type": "application/json",
      },
      (e, status) => new VaultPkiError({ message: `Vault request failed: ${e}`, status }),
    )

    const createP12 = (cert: string, privateKey: string, caChain: string[], password: string): Buffer => {
      const certObj = forge.pki.certificateFromPem(cert)
      const keyObj = forge.pki.privateKeyFromPem(privateKey)
      const caObjs = caChain.map((ca) => forge.pki.certificateFromPem(ca))

      const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keyObj, [certObj, ...caObjs], password, { algorithm: "3des" })

      const p12Der = forge.asn1.toDer(p12Asn1).getBytes()
      return Buffer.from(p12Der, "binary")
    }

    return {
      issueCertAndP12: (email: string, inviteId: string) =>
        Effect.gen(function* () {
          // Check if P12 already exists (idempotency)
          const existing = yield* vault.get(`/secret/data/pki/clients/${inviteId}`).pipe(
            Effect.flatMap(decodeKvSecret),
            Effect.tapError((e) =>
              Effect.logDebug("No existing P12 in Vault (expected on first issue)", { error: String(e) }),
            ),
            Effect.catchAll(() => Effect.succeed(null)),
          )

          if (
            existing?.data.data.p12 &&
            existing?.data.data.password &&
            existing.data.data.serial_number &&
            existing.data.data.not_after
          ) {
            return {
              p12Buffer: Buffer.from(existing.data.data.p12, "base64"),
              password: existing.data.data.password,
              serialNumber: existing.data.data.serial_number,
              notAfter: new Date(existing.data.data.not_after),
            }
          }

          // Issue cert from NAS Vault PKI
          const certResponse = yield* vault
            .post(`/pki-client/issue/client-cert`, {
              common_name: email,
              ttl: "2160h",
            })
            .pipe(
              Effect.flatMap(decodeCertIssue),
              Effect.mapError(
                (e) => new VaultPkiError({ message: "Invalid certificate response from Vault PKI", cause: e }),
              ),
            )

          const certData = certResponse.data

          // Generate random password for P12
          const password = crypto.randomBytes(24).toString("base64")

          // Create P12 bundle
          const p12Buffer = createP12(certData.certificate, certData.private_key, certData.ca_chain ?? [], password)

          // Extract notAfter from Vault response or from the cert PEM
          const notAfter = certData.not_after
            ? new Date(certData.not_after)
            : forge.pki.certificateFromPem(certData.certificate).validity.notAfter

          // Store P12 + password + metadata in Vault
          yield* vault.post(`/secret/data/pki/clients/${inviteId}`, {
            data: {
              p12: p12Buffer.toString("base64"),
              password,
              email,
              serial_number: certData.serial_number,
              not_after: notAfter.toISOString(),
            },
          })

          return { p12Buffer, password, serialNumber: certData.serial_number, notAfter }
        }),

      getP12Password: (inviteId: string) =>
        Effect.gen(function* () {
          const res = yield* vault.get(`/secret/data/pki/clients/${inviteId}`).pipe(
            Effect.flatMap(decodeKvSecret),
            Effect.tapError((e) =>
              Effect.logDebug("Failed to read P12 password from Vault", { inviteId, error: String(e) }),
            ),
            Effect.catchAll(() => Effect.succeed(null)),
          )

          return res?.data.data.password ?? null
        }),

      getP12: (inviteId: string) =>
        Effect.gen(function* () {
          const res = yield* vault.get(`/secret/data/pki/clients/${inviteId}`).pipe(
            Effect.flatMap(decodeKvSecret),
            Effect.tapError((e) => Effect.logDebug("Failed to read P12 from Vault", { inviteId, error: String(e) })),
            Effect.catchAll(() => Effect.succeed(null)),
          )
          const b64 = res?.data.data.p12
          return b64 ? Buffer.from(b64, "base64") : null
        }),

      consumeP12Password: (inviteId: string) =>
        Effect.gen(function* () {
          // Read current secret
          const res = yield* vault.get(`/secret/data/pki/clients/${inviteId}`).pipe(
            Effect.flatMap(decodeKvSecret),
            Effect.tapError((e) => Effect.logDebug("Failed to read P12 for consume", { inviteId, error: String(e) })),
            Effect.catchAll(() => Effect.succeed(null)),
          )

          const password = res?.data.data.password ?? null
          if (!password) return null

          // Write back without password (one-time reveal)
          const { password: _password, ...rest } = res!.data.data
          yield* vault
            .post(`/secret/data/pki/clients/${inviteId}`, {
              data: rest,
            })
            .pipe(
              Effect.tapError((e) =>
                Effect.logWarning("Failed to remove password from Vault after consume", { inviteId, error: String(e) }),
              ),
              Effect.catchAll(() => Effect.void), // logged by the tapError above; removing the password is best-effort
            )

          return password
        }),

      deleteP12Secret: (inviteId: string) =>
        vault.del(`/secret/metadata/pki/clients/${inviteId}`).pipe(
          Effect.asVoid,
          Effect.tapError((e) =>
            Effect.logWarning("Failed to delete P12 secret from Vault", { inviteId, error: String(e) }),
          ),
          Effect.catchAll(() => Effect.void), // logged by the tapError above; deletion is best-effort
        ),

      checkCertProcessed: (username: string) =>
        vault.get(`/secret/data/pki/clients/${username}`).pipe(
          Effect.flatMap(decodeKvSecret),
          Effect.map((r) => r.data.data.source === "p12-generator-controller"),
          Effect.tapError((e) => Effect.logDebug("Failed to check cert processed", { username, error: String(e) })),
          Effect.catchAll(() => Effect.succeed(false)),
        ),

      deleteCertByUsername: (username: string) =>
        vault.del(`/secret/metadata/pki/clients/${username}`).pipe(
          Effect.asVoid,
          Effect.tapError((e) =>
            Effect.logWarning("Failed to delete cert secret by username", { username, error: String(e) }),
          ),
          Effect.catchAll(() => Effect.void), // logged by the tapError above; deletion is best-effort
        ),

      revokeCert: (serialNumber: string) =>
        vault.post(`/pki-client/revoke`, { serial_number: serialNumber }).pipe(
          Effect.asVoid,
          Effect.catchAll((e) => {
            const msg = String(e)
            // Idempotent: already revoked or cert not found
            if (msg.includes("already revoked") || msg.includes("404")) {
              return Effect.void
            }
            return Effect.fail(
              new VaultPkiError({
                message: `Failed to revoke cert: ${msg}`,
                status: e.status,
                permanent: isPermanentStatus(e.status),
              }),
            )
          }),
        ),
    }
  }),
)

// --- CRL publication (duro-worker's CrlPublisher) ---

const VaultCaCertResponse = Schema.Struct({ data: Schema.Struct({ certificate: Schema.String }) })
const VaultPublishedCrl = Schema.Struct({
  data: Schema.Struct({ data: Schema.Struct({ "ca.crl": Schema.optional(Schema.String) }) }),
})
const decodeCaCert = Schema.decodeUnknown(VaultCaCertResponse)
const decodePublishedCrl = Schema.decodeUnknown(VaultPublishedCrl)

/** The KV v2 path Phase 3's broker copies to main Vault for Envoy. */
export const PUBLISHED_CRL_PATH = "/secret/data/pki/client-crl"

/**
 * The NAS Vault calls that publish the `pki-client` CRL: rebuild it, read it
 * and the CA that signs it, and read or write the copy in KV. The `duro-pki`
 * policy grants exactly these paths.
 */
export class VaultCrl extends Context.Tag("VaultCrl")<
  VaultCrl,
  {
    /** `GET pki-client/crl/rotate`: rebuilds the CRL with a fresh nextUpdate. */
    readonly rotateCrl: Effect.Effect<void, VaultPkiError>
    /** `GET pki-client/crl/pem`: the current CRL, PEM text. */
    readonly getCrlPem: Effect.Effect<string, VaultPkiError>
    /** `GET pki-client/cert/ca`: the issuing CA, PEM. */
    readonly getCaPem: Effect.Effect<string, VaultPkiError>
    /** The CRL last written to KV, or null when none was (a 404). */
    readonly readPublishedCrl: Effect.Effect<string | null, VaultPkiError>
    readonly writePublishedCrl: (pem: string) => Effect.Effect<void, VaultPkiError>
  }
>() {}

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
    const invalid = (what: string) => (cause: unknown) =>
      new VaultPkiError({ message: `Invalid ${what} response from Vault`, cause })

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
                      message: `Vault request failed: ${response.status} - ${body.slice(0, 500)}`,
                      status: response.status,
                    }),
                  ),
            ),
          ),
        ),
        Effect.mapError((e) =>
          e instanceof VaultPkiError ? e : new VaultPkiError({ message: `Vault request failed: ${e}`, cause: e }),
        ),
        Effect.scoped,
      )

    return {
      rotateCrl: vault.get(`/pki-client/crl/rotate`).pipe(Effect.asVoid),
      getCrlPem: getText(`/pki-client/crl/pem`),
      getCaPem: vault.get(`/pki-client/cert/ca`).pipe(
        Effect.flatMap(decodeCaCert),
        Effect.mapError((e) => (e instanceof VaultPkiError ? e : invalid("CA certificate")(e))),
        Effect.map((r) => r.data.certificate),
      ),
      readPublishedCrl: vault.get(PUBLISHED_CRL_PATH).pipe(
        Effect.flatMap((body) => decodePublishedCrl(body).pipe(Effect.mapError(invalid("published CRL")))),
        Effect.map((r) => r.data.data["ca.crl"] ?? null),
        Effect.catchIf(
          (e) => e.status === 404,
          () => Effect.succeed(null),
        ),
      ),
      writePublishedCrl: (pem: string) =>
        vault.post(PUBLISHED_CRL_PATH, { data: { "ca.crl": pem } }).pipe(Effect.asVoid),
    }
  }),
)

const mapVaultError = (e: VaultPkiError) =>
  new CertManagerError({ message: e.message, cause: e.cause, permanent: e.permanent })

export const VaultCertManagerLive = Layer.effect(
  CertManager,
  Effect.gen(function* () {
    const vault = yield* VaultPki
    return {
      issueCertAndP12: (email, inviteId) =>
        pipe(vault.issueCertAndP12(email, inviteId), Effect.mapError(mapVaultError)),
      getP12Password: (inviteId) => pipe(vault.getP12Password(inviteId), Effect.mapError(mapVaultError)),
      getP12: (inviteId) => pipe(vault.getP12(inviteId), Effect.mapError(mapVaultError)),
      consumeP12Password: (inviteId) => pipe(vault.consumeP12Password(inviteId), Effect.mapError(mapVaultError)),
      deleteP12Secret: (inviteId) => pipe(vault.deleteP12Secret(inviteId), Effect.mapError(mapVaultError)),
      checkCertProcessed: (username) => pipe(vault.checkCertProcessed(username), Effect.mapError(mapVaultError)),
      deleteCertByUsername: (username) => pipe(vault.deleteCertByUsername(username), Effect.mapError(mapVaultError)),
      revokeCert: (serialNumber) => pipe(vault.revokeCert(serialNumber), Effect.mapError(mapVaultError)),
    }
  }),
).pipe(Layer.provide(VaultPkiLive))
