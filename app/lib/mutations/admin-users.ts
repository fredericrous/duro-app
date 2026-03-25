import { Effect } from "effect"
import { CertManager } from "~/lib/services/CertManager.server"
import { CertificateRepo } from "~/lib/services/CertificateRepo.server"
import { InviteRepo } from "~/lib/services/InviteRepo.server"
import { revokeUser, resendCert } from "~/lib/workflows/invite.server"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdminUsersMutation =
  | { intent: "revokeUser"; username: string; email: string; reason?: string }
  | { intent: "resendCert"; username: string; email: string }
  | { intent: "revokeCert"; serialNumber: string }
  | { intent: "revokeAllCerts"; username: string }
  | { intent: "reinviteRevoked"; revocationId: string }
  | { intent: "revokeCertsBatch"; serialNumbers: string[] }
  | { intent: "revokeAllCertsBatch"; usernames: string[] }

export type AdminUsersResult =
  | { success: true; message: string; reinviteEmail?: string }
  | { error: string }
  | { certRevoked: true; serialNumber: string }
  | { certsRevoked: true; count: number }

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function handleAdminUsersMutation(mutation: AdminUsersMutation) {
  return Effect.gen(function* () {
    switch (mutation.intent) {
      case "revokeUser": {
        yield* revokeUser(mutation.username, mutation.email, "admin", mutation.reason)
        return { success: true as const, message: `User ${mutation.username} revoked` }
      }

      case "resendCert": {
        const result = yield* resendCert(mutation.email, mutation.username)
        return result as AdminUsersResult
      }

      case "revokeCert": {
        const cert = yield* CertManager
        const certRepo = yield* CertificateRepo
        const affected = yield* certRepo.markRevokePending(mutation.serialNumber)
        if (affected === 0) {
          return { error: "Certificate not found or already revoked" }
        }
        yield* cert.revokeCert(mutation.serialNumber).pipe(
          Effect.tap(() => certRepo.markRevokeCompleted(mutation.serialNumber)),
          Effect.tapError((e) =>
            certRepo.markRevokeFailed(mutation.serialNumber, String(e)).pipe(Effect.catchAll(() => Effect.void)),
          ),
        )
        return { certRevoked: true as const, serialNumber: mutation.serialNumber }
      }

      case "revokeAllCerts": {
        const cert = yield* CertManager
        const certRepo = yield* CertificateRepo
        const serials = yield* certRepo.revokeAllForUser(mutation.username)
        for (const serial of serials) {
          yield* cert.revokeCert(serial).pipe(
            Effect.tap(() => certRepo.markRevokeCompleted(serial)),
            Effect.catchAll((e) =>
              certRepo.markRevokeFailed(serial, String(e)).pipe(Effect.catchAll(() => Effect.void)),
            ),
          )
        }
        return { certsRevoked: true as const, count: serials.length }
      }

      case "reinviteRevoked": {
        const repo = yield* InviteRepo
        const revocations = yield* repo.findRevocations()
        const revocation = revocations.find((r) => r.id === mutation.revocationId) ?? null
        if (!revocation) return { error: "Revocation not found" }
        yield* repo.deleteRevocation(mutation.revocationId)
        return {
          success: true as const,
          message: `Revocation cleared for ${revocation.email}. You can now re-invite them.`,
          reinviteEmail: revocation.email,
        }
      }

      case "revokeCertsBatch": {
        const cert = yield* CertManager
        const certRepo = yield* CertificateRepo
        let count = 0
        for (const serial of mutation.serialNumbers) {
          const affected = yield* certRepo.markRevokePending(serial)
          if (affected === 0) continue
          yield* cert.revokeCert(serial).pipe(
            Effect.tap(() => certRepo.markRevokeCompleted(serial)),
            Effect.tapError((e) =>
              certRepo.markRevokeFailed(serial, String(e)).pipe(Effect.catchAll(() => Effect.void)),
            ),
          )
          count++
        }
        return { certsRevoked: true as const, count }
      }

      case "revokeAllCertsBatch": {
        const cert = yield* CertManager
        const certRepo = yield* CertificateRepo
        let total = 0
        for (const username of mutation.usernames) {
          const serials = yield* certRepo.revokeAllForUser(username)
          for (const serial of serials) {
            yield* cert.revokeCert(serial).pipe(
              Effect.tap(() => certRepo.markRevokeCompleted(serial)),
              Effect.catchAll((e) =>
                certRepo.markRevokeFailed(serial, String(e)).pipe(Effect.catchAll(() => Effect.void)),
              ),
            )
          }
          total += serials.length
        }
        return { certsRevoked: true as const, count: total }
      }
    }
  }).pipe(
    Effect.catchAll((e) => {
      const message =
        e instanceof Error
          ? e.message
          : typeof e === "object" && e !== null && "message" in e
            ? String((e as any).message)
            : "Operation failed"
      return Effect.succeed({ error: message } as AdminUsersResult)
    }),
  )
}

// ---------------------------------------------------------------------------
// FormData parser
// ---------------------------------------------------------------------------

export function parseAdminUsersMutation(formData: FormData): AdminUsersMutation | { error: string } {
  const intent = formData.get("intent") as string
  switch (intent) {
    case "revokeUser": {
      const username = formData.get("username") as string
      const email = formData.get("email") as string
      const reason = (formData.get("reason") as string) || undefined
      if (!username || !email) return { error: "Missing username or email" }
      return { intent, username, email, reason }
    }
    case "resendCert": {
      const username = formData.get("username") as string
      const email = formData.get("email") as string
      if (!username || !email) return { error: "Missing username or email" }
      return { intent, username, email }
    }
    case "revokeCert": {
      const serialNumber = formData.get("serialNumber") as string
      if (!serialNumber) return { error: "Missing serial number" }
      return { intent, serialNumber }
    }
    case "revokeAllCerts": {
      const username = formData.get("username") as string
      if (!username) return { error: "Missing username" }
      return { intent, username }
    }
    case "reinviteRevoked": {
      const revocationId = formData.get("revocationId") as string
      if (!revocationId) return { error: "Missing revocation ID" }
      return { intent, revocationId }
    }
    case "revokeCertsBatch": {
      const serialNumbers = formData.getAll("serialNumbers") as string[]
      if (serialNumbers.length === 0) return { error: "Missing serial numbers" }
      return { intent, serialNumbers }
    }
    case "revokeAllCertsBatch": {
      const usernames = formData.getAll("usernames") as string[]
      if (usernames.length === 0) return { error: "Missing usernames" }
      return { intent, usernames }
    }
    default:
      return { error: "Unknown action" }
  }
}
