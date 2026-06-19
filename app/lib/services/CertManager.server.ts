import { Context, Effect, Data, Layer } from "effect"
import * as crypto from "node:crypto"

export class CertManagerError extends Data.TaggedError("CertManagerError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class CertManager extends Context.Tag("CertManager")<
  CertManager,
  {
    readonly issueCertAndP12: (
      email: string,
      inviteId: string,
    ) => Effect.Effect<{ p12Buffer: Buffer; password: string; serialNumber: string; notAfter: Date }, CertManagerError>
    readonly getP12Password: (inviteId: string) => Effect.Effect<string | null, CertManagerError>
    /** Read the stored P12 bundle (for the reveal-page download). Null if absent. */
    readonly getP12: (inviteId: string) => Effect.Effect<Buffer | null, CertManagerError>
    readonly consumeP12Password: (inviteId: string) => Effect.Effect<string | null, CertManagerError>
    readonly deleteP12Secret: (inviteId: string) => Effect.Effect<void, CertManagerError>
    readonly checkCertProcessed: (username: string) => Effect.Effect<boolean, CertManagerError>
    readonly deleteCertByUsername: (username: string) => Effect.Effect<void, CertManagerError>
    readonly revokeCert: (serialNumber: string) => Effect.Effect<void, CertManagerError>
  }
>() {}

// ---------------------------------------------------------------------------
// Dev fake — in-memory cert store, no Vault needed
// ---------------------------------------------------------------------------

const devCertStore = new Map<string, { password: string; serialNumber: string; email: string; p12: Buffer }>()
const devRevokedSerials = new Set<string>()

export const CertManagerDev = Layer.succeed(CertManager, {
  issueCertAndP12: (email, inviteId) => {
    const serialNumber = crypto.randomBytes(8).toString("hex").match(/.{2}/g)!.join(":")
    const password = crypto.randomBytes(12).toString("base64url")
    const notAfter = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
    const p12Buffer = Buffer.from("fake-p12-dev")
    devCertStore.set(inviteId, { password, serialNumber, email, p12: p12Buffer })
    return Effect.succeed({
      p12Buffer,
      password,
      serialNumber,
      notAfter,
    }).pipe(Effect.tap(() => Effect.log(`[DEV] Issued cert for ${email} serial=${serialNumber}`)))
  },

  getP12Password: (inviteId) => Effect.succeed(devCertStore.get(inviteId)?.password ?? null),

  getP12: (inviteId) => Effect.succeed(devCertStore.get(inviteId)?.p12 ?? null),

  consumeP12Password: (inviteId) => Effect.succeed(devCertStore.get(inviteId)?.password ?? null),

  deleteP12Secret: (inviteId) => {
    devCertStore.delete(inviteId)
    return Effect.log(`[DEV] Deleted P12 secret ${inviteId}`)
  },

  checkCertProcessed: (_username) => Effect.succeed(true),

  deleteCertByUsername: (username) => Effect.log(`[DEV] Deleted cert for ${username}`),

  revokeCert: (serialNumber) => {
    devRevokedSerials.add(serialNumber)
    return Effect.log(`[DEV] Revoked cert serial=${serialNumber}`)
  },
})
