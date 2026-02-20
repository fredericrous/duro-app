import { Context, Effect, Data } from "effect"

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
    ) => Effect.Effect<{ p12Buffer: Buffer; password: string }, CertManagerError>
    readonly getP12Password: (inviteId: string) => Effect.Effect<string | null, CertManagerError>
    readonly consumeP12Password: (inviteId: string) => Effect.Effect<string | null, CertManagerError>
    readonly deleteP12Secret: (inviteId: string) => Effect.Effect<void, CertManagerError>
    readonly checkCertProcessed: (username: string) => Effect.Effect<boolean, CertManagerError>
    readonly deleteCertByUsername: (username: string) => Effect.Effect<void, CertManagerError>
  }
>() {}
