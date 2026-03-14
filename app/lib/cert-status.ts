import type { UserCertificate } from "~/lib/services/CertificateRepo.server"

export function certStatus(cert: UserCertificate): "active" | "expired" | "revoked" | "pending" | "failed" {
  if (cert.revokeState === "pending") return "pending"
  if (cert.revokeState === "failed") return "failed"
  if (cert.revokedAt) return "revoked"
  if (new Date(cert.expiresAt) < new Date()) return "expired"
  return "active"
}

export function statusVariant(status: string): "success" | "error" | "warning" | "default" | "info" {
  switch (status) {
    case "active":
      return "success"
    case "expired":
      return "default"
    case "revoked":
      return "error"
    case "pending":
      return "warning"
    case "failed":
      return "error"
    default:
      return "default"
  }
}
