// @vitest-environment node
import { describe, it, expect } from "vitest"
import { certStatus, statusVariant } from "./cert-status"
import type { UserCertificate } from "~/lib/services/CertificateRepo.server"

const base = (overrides: Partial<UserCertificate> = {}): UserCertificate =>
  ({
    id: "c1",
    inviteId: null,
    userId: null,
    username: "alice",
    email: "a@example.com",
    label: "laptop",
    serialNumber: "ABCDEF",
    issuedAt: "2026-01-01T00:00:00Z",
    expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    revokedAt: null,
    revokeState: null,
    revokeError: null,
    ...overrides,
  }) as UserCertificate

describe("certStatus", () => {
  it("reports pending while a revoke is in flight", () => {
    expect(certStatus(base({ revokeState: "pending" }))).toBe("pending")
  })

  it("reports failed when a revoke failed", () => {
    expect(certStatus(base({ revokeState: "failed" }))).toBe("failed")
  })

  it("reports revoked once revokedAt is set", () => {
    expect(certStatus(base({ revokedAt: "2026-02-01T00:00:00Z" }))).toBe("revoked")
  })

  it("reports expired when past the expiry date", () => {
    expect(certStatus(base({ expiresAt: "2000-01-01T00:00:00Z" }))).toBe("expired")
  })

  it("reports active for a fresh, unrevoked certificate", () => {
    expect(certStatus(base())).toBe("active")
  })
})

describe("statusVariant", () => {
  it.each([
    ["active", "success"],
    ["expired", "default"],
    ["revoked", "error"],
    ["pending", "warning"],
    ["failed", "error"],
    ["anything-else", "default"],
  ] as const)("maps %s → %s", (status, variant) => {
    expect(statusVariant(status)).toBe(variant)
  })
})
