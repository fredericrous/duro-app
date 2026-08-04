import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Regression cover for the reveal → burn → revalidate race.
 *
 * Scratching the card POSTs the reveal, which deletes the one-time password in
 * Vault. React Router revalidates right after, so the loader comes back saying
 * `revealed: true` — within a round-trip of the scratch. The page used to swap
 * straight to the "already revealed" card, unmounting the password and its copy
 * button before anyone could press it, which is exactly how a real user lost a
 * password they had just uncovered.
 *
 * This drives the component directly (a stubbed fetcher plus a rerender with the
 * post-burn loader data) rather than a live fetcher round-trip: the two-render
 * sequence is the whole regression, and reproducing it through the real router
 * trips an unrelated pre-existing re-render loop on this page.
 */

const submit = vi.fn()
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useFetcher: () => ({ submit, state: "idle", data: undefined }),
}))
// ScratchCard wraps a <canvas> (no jsdom 2D context); swap it for a clickable
// shim that fires onReveal — same pattern as cert.$revealToken.test.tsx.
vi.mock("~/components/ScratchCard/ScratchCard", () => ({
  ScratchCard: ({ children, onReveal }: { children: React.ReactNode; onReveal: () => void }) => (
    <div data-testid="scratch-card" onClick={onReveal}>
      {children}
    </div>
  ),
}))

import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router"
import CertRevealPage from "./cert.$revealToken"
import { t } from "~/test/test-utils"

// The generated route props carry `params`/`matches` the component never reads;
// this test only varies loaderData.
const Page = CertRevealPage as unknown as (props: { loaderData: unknown }) => React.ReactElement

const withPassword = {
  valid: true as const,
  revealed: false as const,
  email: "user@example.com",
  password: "s3cret-pw",
  appName: "Duro",
}
// What the loader returns once the reveal POST has burned the password.
const afterBurn = { valid: true as const, revealed: true as const, email: "user@example.com", appName: "Duro" }

function renderPage(loaderData: unknown) {
  const ui = (data: unknown) => (
    <MemoryRouter initialEntries={["/cert/tok"]}>
      <Routes>
        <Route path="/cert/:revealToken" element={<Page loaderData={data} />} />
      </Routes>
    </MemoryRouter>
  )
  const view = render(ui(loaderData))
  return { ...view, revalidateWith: (next: unknown) => view.rerender(ui(next)) }
}

beforeEach(() => {
  vi.clearAllMocks()
  // useScratchReveal persists "scratch:/cert/tok" — without this, a card
  // revealed in one test mounts already-open in the next.
  localStorage.clear()
})

describe("CertRevealPage — password survives its own burn", () => {
  it("asks the server to burn the password when the card is scratched", () => {
    renderPage(withPassword)
    fireEvent.click(screen.getByTestId("scratch-card"))
    expect(submit).toHaveBeenCalledWith({ intent: "reveal" }, { method: "post" })
  })

  it("keeps the password and an enabled copy button after the burn revalidates", () => {
    const { revalidateWith } = renderPage(withPassword)
    fireEvent.click(screen.getByTestId("scratch-card"))

    revalidateWith(afterBurn)

    expect(screen.getByDisplayValue("s3cret-pw")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: t("invite.password.copy") })).toBeEnabled()
    expect(screen.queryByText(t("certReveal.revealed.title"))).not.toBeInTheDocument()
    // The .p12 stays downloadable through the burn.
    expect(screen.getByRole("link", { name: t("certReveal.download") })).toHaveAttribute("href", "/cert/tok/download")
  })

  it("still shows the already-revealed card on a fresh visit after the burn", () => {
    renderPage(afterBurn)
    expect(screen.getByText(t("certReveal.revealed.title"))).toBeInTheDocument()
    expect(screen.queryByDisplayValue("s3cret-pw")).not.toBeInTheDocument()
  })
})
