import { Context, Effect, Data, Layer } from "effect"
import * as crypto from "node:crypto"
import forge from "node-forge"

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
  }
>() {}

export const VaultPkiLive = Layer.effect(
  VaultPki,
  Effect.gen(function* () {
    const vaultAddr = process.env.NAS_VAULT_ADDR ?? ""
    const vaultToken = process.env.NAS_VAULT_TOKEN ?? ""

    const vaultFetch = (path: string, options?: RequestInit) =>
      Effect.tryPromise({
        try: () =>
          fetch(`${vaultAddr}/v1${path}`, {
            ...options,
            headers: {
              "X-Vault-Token": vaultToken,
              "Content-Type": "application/json",
              ...options?.headers,
            },
          }).then(async (r) => {
            if (!r.ok) {
              const body = await r.text().catch(() => "")
              throw new Error(`Vault HTTP ${r.status}: ${body}`)
            }
            return r.json() as Promise<Record<string, unknown>>
          }),
        catch: (e) =>
          new VaultPkiError({ message: "Vault request failed", cause: e }),
      })

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
          const existing = yield* vaultFetch(
            `/secret/data/pki/clients/${inviteId}`,
          ).pipe(
            Effect.map((r) => r as { data?: { data?: { p12?: string; password?: string } } }),
            Effect.catchAll(() => Effect.succeed(null)),
          )

          if (existing?.data?.data?.p12 && existing?.data?.data?.password) {
            return {
              p12Buffer: Buffer.from(existing.data.data.p12, "base64"),
              password: existing.data.data.password,
            }
          }

          // Issue cert from NAS Vault PKI
          const certResponse = yield* vaultFetch(
            `/pki-client/issue/client-cert`,
            {
              method: "POST",
              body: JSON.stringify({
                common_name: email,
                ttl: "2160h",
              }),
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
          yield* vaultFetch(`/secret/data/pki/clients/${inviteId}`, {
            method: "POST",
            body: JSON.stringify({
              data: {
                p12: p12Buffer.toString("base64"),
                password,
                email,
              },
            }),
          })

          return { p12Buffer, password }
        }),

      getP12Password: (inviteId: string) =>
        Effect.gen(function* () {
          const res = yield* vaultFetch(
            `/secret/data/pki/clients/${inviteId}`,
          ).pipe(
            Effect.map((r) => r as { data?: { data?: { password?: string } } }),
            Effect.catchAll(() => Effect.succeed(null)),
          )

          return res?.data?.data?.password ?? null
        }),

      consumeP12Password: (inviteId: string) =>
        Effect.gen(function* () {
          // Read current secret
          const res = yield* vaultFetch(
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
            Effect.catchAll(() => Effect.succeed(null)),
          )

          const password = res?.data?.data?.password ?? null
          if (!password) return null

          // Write back without password (one-time reveal)
          const { password: _, ...rest } = res!.data!.data!
          yield* vaultFetch(`/secret/data/pki/clients/${inviteId}`, {
            method: "POST",
            body: JSON.stringify({ data: rest }),
          }).pipe(Effect.catchAll(() => Effect.void))

          return password
        }),
    }
  }),
)
