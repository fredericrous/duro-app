import { beforeEach, describe, expect, it } from "vitest"
import { screen, waitFor, fireEvent } from "@testing-library/react"
import { DevicesSection } from "./DevicesSection"
import { renderRoute } from "~/test/render-route"
import { t } from "~/test/test-utils"
import type { UserCertificate } from "~/lib/services/CertificateRepo.server"

// Helper: build a cert that's N days from expiring.
const certExpiringIn = (days: number, serialNumber = "AABBCC11", over: Partial<UserCertificate> = {}) => {
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
  const issuedAt = new Date(Date.now() - (365 - days) * 24 * 60 * 60 * 1000).toISOString()
  return {
    id: `cert-${serialNumber}`,
    userId: "p-alice",
    label: null,
    serialNumber,
    issuedAt,
    expiresAt,
    revokedAt: null,
    renewedFromSerial: null,
    claimedPlatform: null,
    ...over,
  } as UserCertificate
}

type SectionProps = Parameters<typeof DevicesSection>[0]

// Every intent the section posts, in order — lets a test assert that a click
// the client already knows is pointless never reaches the server.
let submitted: string[] = []

beforeEach(() => {
  submitted = []
})

// The section submits through `useFetcher`, so it needs a real data router (and
// the ToastProvider that renderRoute mounts) — plain `render` can't host it.
function renderSection(
  props: Partial<SectionProps> = {},
  actionResult: unknown = {
    certLinkReady: true,
    revealToken: "tok-1",
    claimUrl: "https://join.example.com/cert/tok-1",
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  },
) {
  return renderRoute({
    route: {
      path: "/devices",
      Component: () => <DevicesSection lastCertRenewalAt={null} certificates={[]} {...props} />,
      loader: () => null,
      action: async ({ request }: { request: Request }) => {
        const fd = await request.formData()
        submitted.push(String(fd.get("intent")))
        return actionResult
      },
    },
    url: "/devices",
  })
}

describe("DevicesSection", () => {
  it("renders the empty-state copy when there are no devices", async () => {
    renderSection()
    expect(await screen.findByText(t("devices.list.empty"))).toBeInTheDocument()
    // Add-a-device button is visible (no cooldown).
    expect(screen.getByRole("button", { name: t("devices.newCert") })).toBeInTheDocument()
  })

  it("renders the device row when one is present", async () => {
    renderSection({ certificates: [certExpiringIn(60)] })
    // The serial number's trailing 8 chars are rendered in <code>.
    expect(await screen.findByText("AABBCC11")).toBeInTheDocument()
  })

  it("renders the imminent-expiry badge when within 7 days", async () => {
    renderSection({ certificates: [certExpiringIn(3, "EXPIRES7")] })
    // The badge uses the plural-aware devices.list.expiresInDays key. Day count
    // is computed off Date.now() with Math.ceil, so we don't know the exact
    // number — resolve the template with count=3 and match the non-numeric
    // portion of the rendered output.
    const sample = t("devices.list.expiresInDays", undefined, { count: 3 })
    const stableFragment = sample.replace(/\d+/, "").trim().split(/\s+/).slice(0, 2).join(" ")
    expect(await screen.findByText(new RegExp(stableFragment, "i"))).toBeInTheDocument()
  })

  it("renders the expired badge for a lapsed certificate", async () => {
    // Expired certs reach this list (the loader lists unrevoked, not valid)
    // precisely so they can still be renewed.
    renderSection({ certificates: [certExpiringIn(-5, "GONE1234")] })
    expect(await screen.findByText(t("devices.list.expired"))).toBeInTheDocument()
  })

  it("explains the cooldown in the dialog instead of swallowing the click", async () => {
    // lastCertRenewalAt < 24h ago → the daily new-device budget is spent.
    // A disabled button would eat the click and tell the user nothing (the
    // reported bug); the dialog has to say what happened and when it lifts.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    renderSection({ lastCertRenewalAt: oneHourAgo })

    const button = await screen.findByRole("button", { name: t("devices.newCert") })
    expect(button).toBeEnabled()
    fireEvent.click(button)

    expect(await screen.findByText(t("devices.qr.cooldownTitle"))).toBeInTheDocument()
    // No QR, and — crucially — no certificate was issued for a click the
    // server would only have rejected.
    expect(screen.queryByRole("img", { name: t("devices.qr.alt") })).not.toBeInTheDocument()
    expect(submitted).toHaveLength(0)

    // The ambient hint stays too, so the limit is visible before clicking.
    // (getAll: the dialog body says something similar — both are wanted.)
    const prefix = t("devices.nextAvailable", undefined, { time: "" }).trim()
    const hits = screen.getAllByText(new RegExp(prefix.split(/\s+/).slice(0, 2).join("\\s+"), "i"))
    expect(hits.length).toBeGreaterThan(0)
  })

  it("keeps a single add-a-device control in the same spot whether or not devices exist", async () => {
    const { unmount } = renderSection()
    expect(await screen.findByRole("button", { name: t("devices.newCert") })).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: t("devices.newCert") })).toHaveLength(1)
    unmount()

    renderSection({ certificates: [certExpiringIn(60), certExpiringIn(20, "SECOND01")] })
    await screen.findByText("AABBCC11")
    expect(screen.getAllByRole("button", { name: t("devices.newCert") })).toHaveLength(1)
  })

  it("issues in ONE click — no chooser step between the button and the QR dialog", async () => {
    renderSection()
    fireEvent.click(await screen.findByRole("button", { name: t("devices.newCert") }))
    // The very next surface is the claim dialog itself.
    expect(await screen.findByText(t("devices.qr.title"))).toBeInTheDocument()
  })

  it("never renders a scratch card — the password is revealed from the email only", async () => {
    renderSection({ certificates: [certExpiringIn(60)] })
    await screen.findByText("AABBCC11")
    expect(screen.queryByRole("button", { name: t("common.scratchToReveal") })).not.toBeInTheDocument()
  })

  describe("issuing a certificate (one click)", () => {
    const submit = async () => {
      fireEvent.click(await screen.findByRole("button", { name: t("devices.newCert") }))
    }

    it("surfaces a failure inline, next to the button that produced it", async () => {
      renderSection({}, { certError: "Vault unreachable" })
      await submit()
      const toast = await waitFor(() => screen.getByRole("alert"))
      expect(toast).toHaveTextContent("Vault unreachable")
      // ...and no claim dialog opens on failure.
      expect(screen.queryByText(t("devices.qr.title"))).not.toBeInTheDocument()
    })
  })

  it("toasts when a certificate is revoked", async () => {
    renderSection({ certificates: [certExpiringIn(60)] }, { certRevoked: true })
    fireEvent.click(await screen.findByRole("button", { name: t("devices.list.revoke") }))
    fireEvent.click(await screen.findByRole("button", { name: t("devices.list.revokeYes") }))
    const toast = await waitFor(() => screen.getByRole("status"))
    expect(toast).toHaveTextContent(t("devices.list.revoked"))
  })

  describe("renaming a device", () => {
    // The rename form submits through `fetcher.Form` while its own onSubmit
    // captures the typed label for the optimistic render and closes the form.
    // Both have to survive the same submit: the optimistic label must stick,
    // and the request must still reach the action.
    it("submits the new label and shows it optimistically", async () => {
      renderSection({ certificates: [certExpiringIn(60, "RENAMEME")] }, { certRenamed: true })
      fireEvent.click(await screen.findByRole("button", { name: t("devices.list.rename") }))
      const input = await screen.findByPlaceholderText(t("devices.devicePlaceholder"))
      fireEvent.change(input, { target: { value: "Work laptop" } })
      fireEvent.click(screen.getByRole("button", { name: t("common.save") }))

      const toast = await waitFor(() => screen.getByRole("status"))
      expect(toast).toHaveTextContent(t("devices.list.renamed"))
      expect(await screen.findByText("Work laptop")).toBeInTheDocument()
    })
  })

  describe("renewing a device", () => {
    it("submits and points the user at their email", async () => {
      // Renewals still deliver by email — only the header's new-device flow
      // switched to the QR link.
      renderSection({ certificates: [certExpiringIn(5, "RENEWME1")] }, { certSent: true })
      fireEvent.click(await screen.findByRole("button", { name: t("devices.renew") }))
      const toast = await waitFor(() => screen.getByRole("status"))
      expect(toast).toHaveTextContent(t("devices.success"))
    })

    it("announces the server's per-cert rate limit", async () => {
      renderSection({ certificates: [certExpiringIn(5, "TOOSOON1")] }, { rateLimited: true, nextAvailable: "later" })
      fireEvent.click(await screen.findByRole("button", { name: t("devices.renew") }))
      const toast = await waitFor(() => screen.getByRole("alert"))
      expect(toast).toHaveTextContent(t("devices.renewTooSoon"))
    })

    it("disables renew on a device renewed within the last 24h", async () => {
      // After a renewal the button sits on the NEW cert, which has no successor
      // of its own — the limit has to come from its own age, or a chain could be
      // extended one cert at a time with no cooldown at all.
      const old = certExpiringIn(5, "OLDSERIAL")
      const replacement = certExpiringIn(90, "NEWSERIAL", {
        renewedFromSerial: "OLDSERIAL",
        issuedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      })
      renderSection({ certificates: [old, replacement] })
      const renew = await screen.findByRole("button", { name: t("devices.renew") })
      expect(renew).toBeDisabled()
      // ...and the row says when it unlocks, so the disabled button isn't a dead end.
      const prefix = t("devices.renewNextAvailable", undefined, { time: "" }).trim()
      expect(screen.getByText(new RegExp(prefix.split(/\s+/).slice(0, 2).join("\\s+"), "i"))).toBeInTheDocument()
    })

    it("shows the superseded cert beneath its device, without its own renew button", async () => {
      const old = certExpiringIn(5, "OLDSERIAL", { label: "MacBook Pro" })
      const replacement = certExpiringIn(90, "NEWSERIAL", {
        label: "MacBook Pro",
        renewedFromSerial: "OLDSERIAL",
        issuedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      })
      renderSection({ certificates: [old, replacement] })
      expect(await screen.findByText(t("devices.replaced"))).toBeInTheDocument()
      // One device, so one renew button — the superseded row offers revoke only.
      expect(screen.getAllByRole("button", { name: t("devices.renew") })).toHaveLength(1)
      expect(screen.getAllByRole("button", { name: t("devices.list.revoke") })).toHaveLength(2)
      // Both certs belong to the same device, so the label is not repeated.
      expect(screen.getAllByText("MacBook Pro")).toHaveLength(1)
    })
  })
})

describe("the QR claim-link flow", () => {
  it("opens the QR dialog directly after the click", async () => {
    renderSection()
    fireEvent.click(await screen.findByRole("button", { name: t("devices.newCert") }))
    expect(await screen.findByText(t("devices.qr.title"))).toBeInTheDocument()
    // the QR encodes the claim URL for the token (it lands once the action answers)
    expect(await screen.findByRole("img", { name: t("devices.qr.alt") })).toBeInTheDocument()
    // and the user is told naming happens on the claim page
    expect(screen.getByText(t("devices.qr.nameHint"))).toBeInTheDocument()
    // the email fallback lives INSIDE the dialog — same token, no second cert
    expect(screen.getByRole("button", { name: t("devices.qr.emailInstead") })).toBeInTheDocument()
  })

  it("shows a loader in the QR's place until the link arrives", async () => {
    // The dialog is the acknowledgement of the click: it must open on the
    // click itself, not when the server eventually answers.
    let release: (() => void) | null = null
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    renderRoute({
      route: {
        path: "/devices",
        Component: () => <DevicesSection lastCertRenewalAt={null} certificates={[]} />,
        loader: () => null,
        action: async () => {
          await held
          return {
            certLinkReady: true,
            revealToken: "tok-1",
            claimUrl: "https://join.example.com/cert/tok-1",
            expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          }
        },
      },
      url: "/devices",
    })

    fireEvent.click(await screen.findByRole("button", { name: t("devices.newCert") }))

    // Open, explaining itself, with the spinner standing in for the code.
    expect(await screen.findByText(t("devices.qr.preparing"))).toBeInTheDocument()
    expect(screen.queryByRole("img", { name: t("devices.qr.alt") })).not.toBeInTheDocument()
    // Copy/email are inert until there is something to copy.
    expect(screen.getByRole("button", { name: t("devices.qr.copyLink") })).toBeDisabled()

    release!()
    expect(await screen.findByRole("img", { name: t("devices.qr.alt") })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: t("devices.qr.copyLink") })).toBeEnabled()
  })

  it("offers a retry inside the dialog when issuing fails", async () => {
    renderSection({}, { certError: "Vault unreachable" })
    fireEvent.click(await screen.findByRole("button", { name: t("devices.newCert") }))

    expect(await screen.findByText(t("devices.qr.errorTitle"))).toBeInTheDocument()
    expect(screen.getByText("Vault unreachable")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: t("devices.qr.retry") }))
    await waitFor(() => expect(submitted.length).toBeGreaterThan(1))
  })

  it("emails the SAME link from inside the dialog and confirms the send", async () => {
    // The action answers per intent: issue → link payload, emailRevealLink → sent.
    renderRoute({
      route: {
        path: "/devices",
        Component: () => <DevicesSection lastCertRenewalAt={null} certificates={[]} />,
        loader: () => null,
        action: async ({ request }) => {
          const fd = await request.formData()
          if (fd.get("intent") === "emailRevealLink") {
            // proves the dialog posts the token it is showing, not a new issue
            expect(fd.get("revealToken")).toBe("tok-1")
            return { certSent: true }
          }
          return {
            certLinkReady: true,
            revealToken: "tok-1",
            claimUrl: "https://join.example.com/cert/tok-1",
            expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          }
        },
      },
      url: "/devices",
    })
    fireEvent.click(await screen.findByRole("button", { name: t("devices.newCert") }))
    // The email fallback only lights up once there is a token to send.
    await screen.findByRole("img", { name: t("devices.qr.alt") })
    fireEvent.click(await screen.findByRole("button", { name: t("devices.qr.emailInstead") }))
    expect(await screen.findByRole("button", { name: t("devices.qr.emailSent") })).toBeDisabled()
  })

  it("offers no name field anywhere — naming moved to the claim page", async () => {
    renderSection()
    fireEvent.click(await screen.findByRole("button", { name: t("devices.newCert") }))
    await screen.findByText(t("devices.qr.title"))
    expect(screen.queryByPlaceholderText(t("devices.devicePlaceholder"))).not.toBeInTheDocument()
  })
})

describe("resuming an interrupted setup", () => {
  const PENDING = { expiresAt: new Date(Date.now() + 3600_000).toISOString() }

  it("offers the waiting setup and reopens it as a link, spending no budget", async () => {
    renderSection({ pendingClaim: PENDING })

    fireEvent.click(await screen.findByRole("button", { name: t("devices.pending.action") }))

    // Same dialog, same QR — but the intent is showClaimLink, NOT a new issue.
    expect(await screen.findByRole("img", { name: t("devices.qr.alt") })).toBeInTheDocument()
    expect(submitted).toEqual(["showClaimLink"])
  })

  it("says nothing when there is no setup waiting", async () => {
    renderSection()
    await screen.findByRole("button", { name: t("devices.newCert") })
    expect(screen.queryByRole("button", { name: t("devices.pending.action") })).not.toBeInTheDocument()
  })

  it("still offers the waiting setup while the daily budget is spent", async () => {
    // The whole point: being interrupted mid-setup must not cost a day.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    renderSection({ pendingClaim: PENDING, lastCertRenewalAt: oneHourAgo })
    expect(await screen.findByRole("button", { name: t("devices.pending.action") })).toBeEnabled()
  })
})

describe("the claimed-platform column", () => {
  it("shows the UA-observed device kind next to a custom label", async () => {
    renderSection({ certificates: [certExpiringIn(60, "PLATFRM1", { label: "perso", claimedPlatform: "iPhone" })] })
    await screen.findByText("perso")
    expect(screen.getByText("iPhone")).toBeInTheDocument()
  })

  it("does not repeat the platform when it IS the label", async () => {
    renderSection({ certificates: [certExpiringIn(60, "PLATFRM2", { label: "iPhone", claimedPlatform: "iPhone" })] })
    await screen.findByText("iPhone")
    expect(screen.getAllByText("iPhone")).toHaveLength(1)
  })
})
