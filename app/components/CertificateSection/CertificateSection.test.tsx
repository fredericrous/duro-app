import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { CertificateSection } from "./CertificateSection"
import { t } from "~/test/test-utils"
import type { UserCertificate } from "~/lib/services/CertificateRepo.server"

// Helper: build a cert that's N days from expiring.
const certExpiringIn = (days: number, serialNumber = "AABBCC11"): UserCertificate => {
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
  const issuedAt = new Date(Date.now() - (365 - days) * 24 * 60 * 60 * 1000).toISOString()
  return {
    id: `cert-${serialNumber}`,
    userId: "p-alice",
    serialNumber,
    issuedAt,
    expiresAt,
    revokedAt: null,
  } as UserCertificate
}

describe("CertificateSection", () => {
  it("renders the empty-state copy when there are no certificates", () => {
    render(
      <CertificateSection email="alice@example.com" p12Password={null} lastCertRenewalAt={null} certificates={[]} />,
    )
    expect(screen.getByText(t("settings.cert.list.empty"))).toBeInTheDocument()
    // Issue-new-cert button is visible (no effectivePassword and no cooldown).
    expect(screen.getByRole("button")).toBeInTheDocument()
  })

  it("renders the certificate row when one is present", () => {
    render(
      <CertificateSection
        email="alice@example.com"
        p12Password={null}
        lastCertRenewalAt={null}
        certificates={[certExpiringIn(60)]}
      />,
    )
    // The serial number's trailing 8 chars are rendered in <code>.
    expect(screen.getByText("AABBCC11")).toBeInTheDocument()
  })

  it("renders the imminent-expiry badge when within 7 days", () => {
    render(
      <CertificateSection
        email="alice@example.com"
        p12Password={null}
        lastCertRenewalAt={null}
        certificates={[certExpiringIn(3, "EXPIRES7")]}
      />,
    )
    // The badge uses the plural-aware settings.cert.list.expiresInDays key.
    // Day count is computed off Date.now() with Math.ceil, so we don't know
    // the exact number — resolve the template with count=3 and match the
    // non-numeric portion of the rendered output.
    const sample = t("settings.cert.list.expiresInDays", undefined, { count: 3 })
    const stableFragment = sample.replace(/\d+/, "").trim().split(/\s+/).slice(0, 2).join(" ")
    expect(screen.getByText(new RegExp(stableFragment, "i"))).toBeInTheDocument()
  })

  it("disables the new-cert button when the user is in cooldown", () => {
    // lastCertRenewalAt < 24h ago → cooldown active.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    render(
      <CertificateSection
        email="alice@example.com"
        p12Password={null}
        lastCertRenewalAt={oneHourAgo}
        certificates={[]}
      />,
    )
    // The button rendered under cooldownRemaining is disabled.
    const buttons = screen.getAllByRole("button")
    expect(buttons.some((b) => (b as HTMLButtonElement).disabled)).toBe(true)
  })

  it("renders the PasswordReveal when a p12 password is supplied", () => {
    render(
      <CertificateSection
        email="alice@example.com"
        p12Password="ThisIsTheP12Password123!"
        lastCertRenewalAt={null}
        certificates={[]}
      />,
    )
    // PasswordReveal renders a "show/copy password" UI; assert some button
    // is present. We don't depend on the exact label since it's translated.
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0)
  })
})
