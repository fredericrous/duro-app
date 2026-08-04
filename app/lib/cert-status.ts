import type { UserCertificate } from "~/lib/services/CertificateRepo.server"

const ONE_DAY_MS = 24 * 60 * 60 * 1000

/**
 * How close a certificate is to expiry. Derived from the wall clock at call
 * time rather than memoised, so a threshold crossed while the page is open
 * takes effect on the next render instead of needing a remount.
 */
export function expiryStatus(expiresAt: string): "ok" | "soon" | "imminent" | "expired" {
  const days = daysUntil(expiresAt)
  if (days <= 0) return "expired"
  if (days <= 7) return "imminent"
  if (days <= 30) return "soon"
  return "ok"
}

export function daysUntil(expiresAt: string): number {
  return Math.ceil((new Date(expiresAt).getTime() - Date.now()) / ONE_DAY_MS)
}

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
