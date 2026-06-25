// @vitest-environment node
import { describe, it, expect } from "vitest"
import { render } from "@react-email/render"
import { createI18nInstance } from "~/lib/i18n.server"
import { InviteEmail } from "./invite-email"
import { CertRenewalEmail } from "./cert-renewal-email"

const fixedT = async () => {
  const i18n = await createI18nInstance("en")
  return i18n.getFixedT("en")
}

describe("email templates (@duro-app/ui-email)", () => {
  it("InviteEmail: token-driven, dark/light-aware, attachment-free CTA", async () => {
    const t = await fixedT()
    const html = await render(
      InviteEmail({
        inviteUrl: "https://join.example/invite/tok",
        reinviteUrl: "https://join.example/reinvite/tok",
        invitedBy: "admin",
        appName: "Duro",
        appDescription: "a dashboard",
        clickUrl: "https://join.example/c/tok",
        pixelUrl: "https://join.example/e/open",
        t,
      }),
    )
    const flat = html.replace(/\s/g, "")
    // dark/light mechanism
    expect(html).toContain("@media (prefers-color-scheme: dark)")
    expect(html).toContain('name="color-scheme"')
    // button uses the real accent token, not the old hand-rolled #3b82f6
    expect(flat).toMatch(/background-color:#1e40af/i) // light accent (inline base)
    expect(flat).toMatch(/\.d-btn\{background-color:#6aaffc!important/i) // dark accent override
    expect(html).not.toContain("3b82f6")
    // CTA points at the click-tracking redirector, pixel is rendered
    expect(html).toContain("https://join.example/c/tok")
    expect(html).toContain("https://join.example/e/open")
  })

  it("CertRenewalEmail: renders the reveal link + dark/light", async () => {
    const t = await fixedT()
    const html = await render(CertRenewalEmail({ appName: "Duro", t, revealUrl: "https://join.example/cert/tok" }))
    expect(html).toContain("https://join.example/cert/tok")
    expect(html).toContain("@media (prefers-color-scheme: dark)")
    expect(html).not.toContain("3b82f6")
  })
})
