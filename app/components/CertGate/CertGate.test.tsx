import { describe, it, expect } from "vitest"
import { Suspense } from "react"
import { screen, waitFor } from "@testing-library/react"
import { CertGate } from "./CertGate"
import { renderRoute } from "~/test/render-route"
import { t } from "~/test/test-utils"

// CertGate reads useParams/useSubmit/useNavigation and suspends on certPromise,
// so it needs a data-router context (renderRoute) plus a Suspense boundary.
const renderGate = (certInstalled: boolean, actionData?: { error?: string }) => {
  const certPromise = Promise.resolve(certInstalled)
  const Wrapper = () => (
    <Suspense fallback={null}>
      <CertGate certPromise={certPromise} actionData={actionData} />
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

  it("renders the create-account form once the cert is installed", async () => {
    renderGate(true)
    await waitFor(() => {
      expect(screen.getByPlaceholderText(t("createAccount.username.placeholder"))).toBeInTheDocument()
    })
    expect(screen.getByPlaceholderText(t("createAccount.password.placeholder"))).toBeInTheDocument()
    expect(screen.getByRole("button", { name: t("createAccount.submit") })).toBeInTheDocument()
  })

  it("surfaces an action error above the form", async () => {
    renderGate(true, { error: "Username already taken" })
    await waitFor(() => {
      expect(screen.getByText("Username already taken")).toBeInTheDocument()
    })
  })
})
