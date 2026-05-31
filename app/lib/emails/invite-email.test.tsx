// @vitest-environment node
import { describe, expect, it } from "vitest"
import { render } from "@react-email/render"
import { InviteEmail } from "./invite-email"
import { createI18nInstance } from "~/lib/i18n.server"

async function renderInvite(opts: { pixelUrl?: string; clickUrl?: string } = {}) {
  const i18n = await createI18nInstance("en")
  const t = i18n.getFixedT("en")
  return render(
    InviteEmail({
      inviteUrl: "https://join.example/invite/tok",
      reinviteUrl: "https://join.example/reinvite/tok",
      invitedBy: "admin",
      appName: "Duro",
      appDescription: "a private platform",
      clickUrl: opts.clickUrl,
      pixelUrl: opts.pixelUrl,
      t,
    }),
  )
}

describe("InviteEmail open-tracking pixel", () => {
  it("embeds the pixel when a pixelUrl is provided", async () => {
    const html = await renderInvite({ pixelUrl: "https://join.example/e/open-abc" })
    expect(html).toContain("https://join.example/e/open-abc")
    // It's an <img> (open-tracking pixel), not a link.
    expect(html).toMatch(/<img[^>]+src="https:\/\/join\.example\/e\/open-abc"/)
  })

  it("renders no pixel when pixelUrl is omitted (older invites / dev)", async () => {
    const html = await renderInvite()
    expect(html).not.toContain("/e/")
  })
})

describe("InviteEmail CTA click-tracking", () => {
  it("points the CTA button at the clickUrl redirector when provided", async () => {
    const html = await renderInvite({ clickUrl: "https://join.example/c/tok" })
    // The CTA href is the redirector, not the direct invite URL.
    expect(html).toMatch(/href="https:\/\/join\.example\/c\/tok"/)
  })

  it("falls back to the direct inviteUrl when no clickUrl is given", async () => {
    const html = await renderInvite()
    expect(html).toMatch(/href="https:\/\/join\.example\/invite\/tok"/)
    expect(html).not.toContain("/c/")
  })
})
