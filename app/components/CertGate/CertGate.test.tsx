import { describe, it, expect } from "vitest"
import { Suspense } from "react"
import { screen, waitFor } from "@testing-library/react"
import { CertGate } from "./CertGate"
import { renderRoute } from "~/test/render-route"
import { t } from "~/test/test-utils"

// CertGate reads useParams/useSubmit/useNavigation and suspends on certPromise,
// so it needs a data-router context (renderRoute) plus a Suspense boundary.
const SYSTEM_STORE = { store: "system" as const, onIos: false, inviteUrl: null, chromeUrl: null }

const renderGate = (
  certInstalled: boolean,
  actionData?: { error?: string },
  browser: Parameters<typeof CertGate>[0]["browser"] = SYSTEM_STORE,
) => {
  const certPromise = Promise.resolve(certInstalled)
  const Wrapper = () => (
    <Suspense fallback={null}>
      <CertGate certPromise={certPromise} actionData={actionData} browser={browser} />
    </Suspense>
  )
  return renderRoute({
    route: {
      path: "/invite/:token/create-account",
      Component: Wrapper as never,
      loader: () => ({}),
    },
    url: "/invite/tok/create-account",
  })
}

describe("CertGate", () => {
  it("blocks account creation with a back link when the cert isn't installed", async () => {
    renderGate(false)
    await waitFor(() => {
      expect(screen.getByText(t("createAccount.certRequired.title"))).toBeInTheDocument()
    })
    const back = screen.getByRole("link", { name: t("createAccount.certRequired.back") })
    expect(back).toHaveAttribute("href", "/invite/tok")
  })

  it("explains the browser instead of sending a certless browser back to install again", async () => {
    // Firefox for Android already has the certificate installed on the phone —
    // "go back and install it" would send it round the same loop forever.
    renderGate(false, undefined, {
      store: "none",
      onIos: false,
      inviteUrl: "https://join.example.com/invite/tok",
      chromeUrl: "intent://join.example.com/invite/tok#Intent;scheme=https;package=com.android.chrome;end",
    })
    await waitFor(() => {
      expect(screen.getByText(t("invite.cert.unsupported.title"))).toBeInTheDocument()
    })
    expect(screen.queryByText(t("createAccount.certRequired.title"))).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: t("invite.cert.unsupported.openChrome") })).toHaveAttribute(
      "href",
      "intent://join.example.com/invite/tok#Intent;scheme=https;package=com.android.chrome;end",
    )
  })

  it("renders the create-account form once the cert is installed", async () => {
    renderGate(true)
    await waitFor(() => {
      expect(screen.getByPlaceholderText(t("createAccount.username.placeholder"))).toBeInTheDocument()
    })
    expect(screen.getByPlaceholderText(t("createAccount.password.placeholder"))).toBeInTheDocument()
    expect(screen.getByRole("button", { name: t("createAccount.submit") })).toBeInTheDocument()
  })

  it("surfaces an action error above the form, mapped from its code", async () => {
    renderGate(true, { error: "password_mismatch" })
    await waitFor(() => {
      expect(screen.getByText(t("createAccount.error.password_mismatch"))).toBeInTheDocument()
    })
  })

  it("falls back to a generic message for an unknown error code", async () => {
    renderGate(true, { error: "something_unexpected" })
    await waitFor(() => {
      expect(screen.getByText(t("createAccount.error.create_failed"))).toBeInTheDocument()
    })
  })
})
