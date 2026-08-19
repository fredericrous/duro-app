import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, fireEvent, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import en from "~/locales/en/translation.json"
import { renderRoute } from "~/test/render-route"

vi.mock("~/components/ScratchCard/ScratchCard", () => ({
  ScratchCard: ({ children, onReveal }: { children: React.ReactNode; onReveal: () => void }) => (
    <div role="button" aria-label="scratch to reveal" onClick={onReveal}>
      {children}
    </div>
  ),
}))

import { InvitePasswordReveal } from "./InvitePasswordReveal"

// The component posts intent=reveal through useFetcher, so it needs a data
// router; the action plays the server handing out the password ONLY on that
// POST — mirroring the real /invite/:token contract.
const renderReveal = (hasPassword: boolean) =>
  renderRoute({
    route: {
      path: "/invite/:token",
      Component: () => <InvitePasswordReveal hasPassword={hasPassword} />,
      loader: () => null,
      action: () => ({ revealed: true, p12Password: "s3cret" }),
    },
    url: "/invite/tok",
  })

beforeEach(() => {
  localStorage.clear()
  // jsdom ships no Clipboard API. useCopyFeedback now reports the real outcome
  // of writeText, so the stub has to exist (and resolve) for a copy to count as
  // one — an absent clipboard is a failure, not a success.
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  })
})

describe("InvitePasswordReveal", () => {
  it("shows consumed message when no password remains", async () => {
    renderReveal(false)
    expect(await screen.findByText(en.invite.password.consumed)).toBeInTheDocument()
  })

  it("keeps the input EMPTY with copy disabled before reveal — the secret hasn't left the server", async () => {
    renderReveal(true)
    const copyBtn = await screen.findByRole("button", { name: en.invite.password.copy })
    expect(copyBtn).toBeDisabled()
    expect(screen.queryByDisplayValue("s3cret")).not.toBeInTheDocument()
  })

  it("scratch fetches the password, enables copy and shows oneTime text", async () => {
    const user = userEvent.setup()
    renderReveal(true)

    await user.click(await screen.findByRole("button", { name: "scratch to reveal" }))

    expect(await screen.findByDisplayValue("s3cret")).toBeInTheDocument()
    const copyBtn = screen.getByRole("button", { name: en.invite.password.copy })
    expect(copyBtn).toBeEnabled()
    expect(screen.getByText(en.invite.password.oneTime)).toBeVisible()
  })

  it("copies password and shows copied text", async () => {
    const user = userEvent.setup()
    renderReveal(true)
    await user.click(await screen.findByRole("button", { name: "scratch to reveal" }))
    await screen.findByDisplayValue("s3cret")

    fireEvent.click(screen.getByRole("button", { name: en.invite.password.copy }))

    // The label flips only once writeText resolves.
    expect(await screen.findByRole("button", { name: en.invite.password.copied })).toBeInTheDocument()
  })

  it("resets copied text after timeout", async () => {
    // shouldAdvanceTime lets the writeText promise settle under fake timers —
    // the copy feedback is now driven by that resolution, not by the click.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderReveal(true)

    // Use fireEvent (synchronous) to avoid userEvent's internal timers conflicting with fake timers
    fireEvent.click(await screen.findByRole("button", { name: "scratch to reveal" }))
    await screen.findByDisplayValue("s3cret")
    fireEvent.click(screen.getByRole("button", { name: en.invite.password.copy }))

    expect(await screen.findByRole("button", { name: en.invite.password.copied })).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(screen.getByRole("button", { name: en.invite.password.copy })).toBeInTheDocument()
    vi.useRealTimers()
  })
})
