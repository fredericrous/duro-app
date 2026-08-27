import { describe, it, expect, vi } from "vitest"
import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { CertCheck } from "./CertCheck"
import { renderRoute } from "~/test/render-route"
import { t } from "~/test/test-utils"

const CHROME_INTENT = "intent://join.example.com/invite/tok#Intent;scheme=https;package=com.android.chrome;end"

// CertCheck reads useParams for the "continue" link, so it needs a data router;
// the stub hydrates asynchronously, hence the findBy* first assertion in each test.
const renderCheck = (props: Partial<Parameters<typeof CertCheck>[0]> = {}) => {
  const Wrapper = () => <CertCheck status="not-installed" onRecheck={props.onRecheck ?? (() => {})} {...props} />
  return renderRoute({
    route: { path: "/invite/:token", Component: Wrapper as never, loader: () => ({}) },
    url: "/invite/tok",
  })
}

describe("CertCheck", () => {
  it("offers a retry when the certificate merely isn't installed yet", async () => {
    renderCheck()
    expect(await screen.findByText(t("invite.cert.notInstalled"))).toBeInTheDocument()
    expect(screen.getByRole("button", { name: t("invite.cert.retry") })).toBeInTheDocument()
  })

  it("re-runs the probe when retry is clicked", async () => {
    const onRecheck = vi.fn()
    renderCheck({ onRecheck })
    await userEvent.click(await screen.findByRole("button", { name: t("invite.cert.retry") }))
    expect(onRecheck).toHaveBeenCalledOnce()
  })

  describe("a browser with no certificate store", () => {
    const unsupported = {
      store: "none" as const,
      inviteUrl: "https://join.example.com/invite/tok",
      chromeUrl: CHROME_INTENT,
    }

    it("says the browser is the problem instead of the missing certificate", async () => {
      renderCheck(unsupported)
      expect(await screen.findByText(t("invite.cert.unsupported.title"))).toBeInTheDocument()
      expect(screen.queryByText(t("invite.cert.notInstalled"))).not.toBeInTheDocument()
    })

    it("drops the retry button, which could only ever fail here", async () => {
      // The whole point of this state is to end the refresh loop — leaving the
      // button would invite the visitor straight back into it.
      renderCheck(unsupported)
      await screen.findByText(t("invite.cert.unsupported.title"))
      expect(screen.queryByRole("button", { name: t("invite.cert.retry") })).not.toBeInTheDocument()
      expect(screen.queryByRole("button", { name: t("invite.cert.checking") })).not.toBeInTheDocument()
    })

    it("hands Android a one-tap way into Chrome", async () => {
      renderCheck(unsupported)
      expect(await screen.findByRole("link", { name: t("invite.cert.unsupported.openChrome") })).toHaveAttribute(
        "href",
        CHROME_INTENT,
      )
    })

    it("falls back to a copyable link where no intent URL applies", async () => {
      renderCheck({ ...unsupported, chromeUrl: null, onIos: true })
      expect(await screen.findByText(t("invite.cert.unsupported.ios"))).toBeInTheDocument()
      expect(screen.queryByRole("link", { name: t("invite.cert.unsupported.openChrome") })).not.toBeInTheDocument()
      expect(screen.getByRole("button", { name: t("invite.cert.unsupported.copyLink") })).toBeInTheDocument()
    })

    it("still lets a misread User-Agent through once the probe actually succeeds", async () => {
      // "none" is a guess read off a User-Agent; a successful probe is proof.
      // Proof wins, or a spoofed UA would lock out a browser that works.
      renderCheck({ ...unsupported, status: "installed" })
      expect(await screen.findByRole("link", { name: t("invite.cert.continue") })).toHaveAttribute(
        "href",
        "/invite/tok/create-account",
      )
      expect(screen.queryByText(t("invite.cert.unsupported.title"))).not.toBeInTheDocument()
    })
  })

  it("tells desktop Firefox to import into its own store, not to reopen the browser", async () => {
    renderCheck({ store: "own" })
    expect(await screen.findByText(t("invite.cert.notInstalled"))).toBeInTheDocument()
    expect(screen.queryByText(t("invite.cert.hint"))).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: t("invite.cert.retry") })).toBeInTheDocument()
  })
})
