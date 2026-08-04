import { describe, expect, it } from "vitest"
import { screen, waitFor, fireEvent } from "@testing-library/react"
import { CertificateSection } from "./CertificateSection"
import { renderRoute } from "~/test/render-route"
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

type SectionProps = Parameters<typeof CertificateSection>[0]

// The section submits through `useFetcher`, so it needs a real data router (and
// the ToastProvider that renderRoute mounts) — plain `render` can't host it.
function renderSection(props: Partial<SectionProps> = {}, actionResult: unknown = { certSent: true }) {
  return renderRoute({
    route: {
      path: "/settings/certificate",
      Component: () => (
        <CertificateSection email="alice@example.com" lastCertRenewalAt={null} certificates={[]} {...props} />
      ),
      loader: () => null,
      action: () => actionResult,
    },
    url: "/settings/certificate",
  })
}

describe("CertificateSection", () => {
  it("renders the empty-state copy when there are no certificates", async () => {
    renderSection()
    expect(await screen.findByText(t("settings.cert.list.empty"))).toBeInTheDocument()
    // Issue-new-cert button is visible (no cooldown).
    expect(screen.getByRole("button", { name: t("settings.cert.newCert") })).toBeInTheDocument()
  })

  it("renders the certificate row when one is present", async () => {
    renderSection({ certificates: [certExpiringIn(60)] })
    // The serial number's trailing 8 chars are rendered in <code>.
    expect(await screen.findByText("AABBCC11")).toBeInTheDocument()
  })

  it("renders the imminent-expiry badge when within 7 days", async () => {
    renderSection({ certificates: [certExpiringIn(3, "EXPIRES7")] })
    // The badge uses the plural-aware settings.cert.list.expiresInDays key.
    // Day count is computed off Date.now() with Math.ceil, so we don't know
    // the exact number — resolve the template with count=3 and match the
    // non-numeric portion of the rendered output.
    const sample = t("settings.cert.list.expiresInDays", undefined, { count: 3 })
    const stableFragment = sample.replace(/\d+/, "").trim().split(/\s+/).slice(0, 2).join(" ")
    expect(await screen.findByText(new RegExp(stableFragment, "i"))).toBeInTheDocument()
  })

  it("disables the new-cert button when the user is in cooldown", async () => {
    // lastCertRenewalAt < 24h ago → cooldown active.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    renderSection({ lastCertRenewalAt: oneHourAgo })
    const button = await screen.findByRole("button", { name: t("settings.cert.newCert") })
    expect(button).toBeDisabled()
  })

  it("never renders a scratch card — the password is revealed from the email only", async () => {
    renderSection({ certificates: [certExpiringIn(60)] })
    await screen.findByText("AABBCC11")
    expect(screen.queryByRole("button", { name: t("common.scratchToReveal") })).not.toBeInTheDocument()
  })

  describe("issuing a certificate", () => {
    const submit = async () => {
      fireEvent.click(await screen.findByRole("button", { name: t("settings.cert.newCert") }))
      fireEvent.click(await screen.findByRole("button", { name: t("settings.cert.confirmButton") }))
    }

    it("closes the confirm form and points the user at their email", async () => {
      renderSection()
      await submit()
      // The toast auto-dismisses, so the "check your email" pointer also
      // persists inline, next to the button that produced it.
      expect(await screen.findByText(t("settings.cert.success"))).toBeInTheDocument()
      expect(screen.queryByRole("button", { name: t("settings.cert.confirmButton") })).not.toBeInTheDocument()
      expect(screen.queryByRole("button", { name: t("common.cancel") })).not.toBeInTheDocument()
    })

    it("toasts the success where the user is looking", async () => {
      renderSection()
      await submit()
      const toast = await waitFor(() => screen.getByRole("status"))
      expect(toast).toHaveTextContent(t("settings.cert.success"))
    })

    it("surfaces a failure without closing the form", async () => {
      renderSection({}, { certError: "Vault unreachable" })
      await submit()
      const toast = await waitFor(() => screen.getByRole("alert"))
      expect(toast).toHaveTextContent("Vault unreachable")
      expect(screen.getByRole("button", { name: t("settings.cert.confirmButton") })).toBeInTheDocument()
    })
  })

  it("toasts when a certificate is revoked", async () => {
    renderSection({ certificates: [certExpiringIn(60)] }, { certRevoked: true })
    fireEvent.click(await screen.findByRole("button", { name: t("settings.cert.list.revoke") }))
    fireEvent.click(await screen.findByRole("button", { name: t("settings.cert.list.revokeYes") }))
    const toast = await waitFor(() => screen.getByRole("status"))
    expect(toast).toHaveTextContent(t("settings.cert.list.revoked"))
  })
})
