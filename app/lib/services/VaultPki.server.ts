import { Context, Effect, Data, Layer, Config, Redacted } from "effect"
import * as HttpClient from "@effect/platform/HttpClient"
import * as crypto from "node:crypto"
import forge from "node-forge"
import { makeJsonApi } from "~/lib/http.server"

export class VaultPkiError extends Data.TaggedError("VaultPkiError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class VaultPki extends Context.Tag("VaultPki")<
  VaultPki,
  {
    readonly issueCertAndP12: (
      email: string,
      inviteId: string,
    ) => Effect.Effect<{ p12Buffer: Buffer; password: string }, VaultPkiError>
    readonly getP12Password: (
      inviteId: string,
    ) => Effect.Effect<string | null, VaultPkiError>
    readonly consumeP12Password: (
      inviteId: string,
    ) => Effect.Effect<string | null, VaultPkiError>
    readonly deleteP12Secret: (
      inviteId: string,
    ) => Effect.Effect<void, VaultPkiError>
    readonly checkCertProcessed: (
      username: string,
    ) => Effect.Effect<boolean, VaultPkiError>
    readonly deleteCertByUsername: (
      username: string,
    ) => Effect.Effect<void, VaultPkiError>
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
      (e) => new VaultPkiError({ message: "Vault request failed", cause: e }),
    )

    const createP12 = (
      cert: string,
      privateKey: string,
      caChain: string[],
      password: string,
    ): Buffer => {
      const certObj = forge.pki.certificateFromPem(cert)
      const keyObj = forge.pki.privateKeyFromPem(privateKey)
      const caObjs = caChain.map((ca) => forge.pki.certificateFromPem(ca))

      const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
        keyObj,
        [certObj, ...caObjs],
        password,
        { algorithm: "3des" },
      )

      const p12Der = forge.asn1.toDer(p12Asn1).getBytes()
      return Buffer.from(p12Der, "binary")
    }

    return {
      issueCertAndP12: (email: string, inviteId: string) =>
        Effect.gen(function* () {
          // Check if P12 already exists (idempotency)
          const existing = yield* vault.get(
            `/secret/data/pki/clients/${inviteId}`,
          ).pipe(
            Effect.map((r) => r as { data?: { data?: { p12?: string; password?: string } } }),
            Effect.tapError((e) => Effect.logDebug("No existing P12 in Vault (expected on first issue)", { error: String(e) })),
            Effect.catchAll(() => Effect.succeed(null)),
          )

          if (existing?.data?.data?.p12 && existing?.data?.data?.password) {
            return {
              p12Buffer: Buffer.from(existing.data.data.p12, "base64"),
              password: existing.data.data.password,
            }
          }

          // Issue cert from NAS Vault PKI
          const certResponse = yield* vault.post(
            `/pki-client/issue/client-cert`,
            {
              common_name: email,
              ttl: "2160h",
            },
          )

          const certData = (certResponse as {
            data: {
              certificate: string
              private_key: string
              ca_chain: string[]
              serial_number: string
            }
          }).data

          if (!certData?.certificate || !certData?.private_key) {
            return yield* new VaultPkiError({
              message: "Invalid certificate response from Vault PKI",
            })
          }

          // Generate random password for P12
          const password = crypto.randomBytes(24).toString("base64")

          // Create P12 bundle
          const p12Buffer = createP12(
            certData.certificate,
            certData.private_key,
            certData.ca_chain ?? [],
            password,
          )

          // Store P12 + password in Vault
          yield* vault.post(`/secret/data/pki/clients/${inviteId}`, {
            data: {
              p12: p12Buffer.toString("base64"),
              password,
              email,
            },
          })

          return { p12Buffer, password }
        }),

      getP12Password: (inviteId: string) =>
        Effect.gen(function* () {
          const res = yield* vault.get(
            `/secret/data/pki/clients/${inviteId}`,
          ).pipe(
            Effect.map((r) => r as { data?: { data?: { password?: string } } }),
            Effect.tapError((e) => Effect.logDebug("Failed to read P12 password from Vault", { inviteId, error: String(e) })),
            Effect.catchAll(() => Effect.succeed(null)),
          )

          return res?.data?.data?.password ?? null
        }),

      consumeP12Password: (inviteId: string) =>
        Effect.gen(function* () {
          // Read current secret
          const res = yield* vault.get(
            `/secret/data/pki/clients/${inviteId}`,
          ).pipe(
            Effect.map(
              (r) =>
                r as {
                  data?: {
                    data?: { p12?: string; password?: string; email?: string }
                  }
                },
            ),
            Effect.tapError((e) => Effect.logDebug("Failed to read P12 for consume", { inviteId, error: String(e) })),
            Effect.catchAll(() => Effect.succeed(null)),
          )

          const password = res?.data?.data?.password ?? null
          if (!password) return null

          // Write back without password (one-time reveal)
          const { password: _, ...rest } = res!.data!.data!
          yield* vault.post(`/secret/data/pki/clients/${inviteId}`, {
            data: rest,
          }).pipe(
            Effect.tapError((e) => Effect.logWarning("Failed to remove password from Vault after consume", { inviteId, error: String(e) })),
            Effect.catchAll(() => Effect.void),
          )

          return password
        }),

      deleteP12Secret: (inviteId: string) =>
        vault.del(`/secret/metadata/pki/clients/${inviteId}`).pipe(
          Effect.asVoid,
          Effect.tapError((e) => Effect.logDebug("Failed to delete P12 secret from Vault", { inviteId, error: String(e) })),
          Effect.catchAll(() => Effect.void),
        ),

      checkCertProcessed: (username: string) =>
        vault.get(`/secret/data/pki/clients/${username}`).pipe(
          Effect.map((r) => {
            const data = (r as { data?: { data?: { source?: string } } })?.data
              ?.data
            return data?.source === "p12-generator-controller"
          }),
          Effect.tapError((e) => Effect.logDebug("Failed to check cert processed", { username, error: String(e) })),
          Effect.catchAll(() => Effect.succeed(false)),
        ),

      deleteCertByUsername: (username: string) =>
        vault.del(`/secret/metadata/pki/clients/${username}`).pipe(
          Effect.asVoid,
          Effect.tapError((e) => Effect.logDebug("Failed to delete cert secret by username", { username, error: String(e) })),
          Effect.catchAll(() => Effect.void),
        ),
    }
  }),
)
