import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import en from "~/locales/en/translation.json"

vi.mock("~/components/ScratchCard/ScratchCard", () => ({
  ScratchCard: ({ children, onReveal }: { children: React.ReactNode; onReveal: () => void }) => (
    <div data-testid="scratch-card" onClick={onReveal}>
      {children}
    </div>
  ),
}))

import { InvitePasswordReveal } from "./InvitePasswordReveal"

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
  it("shows consumed message when password is null", () => {
    render(<InvitePasswordReveal p12Password={null} />)
    expect(screen.getByText(en.invite.password.consumed)).toBeInTheDocument()
  })

  it("shows password input with copy disabled before reveal", () => {
    render(<InvitePasswordReveal p12Password="s3cret" />)
    expect(screen.getByDisplayValue("s3cret")).toBeInTheDocument()
    const copyBtn = screen.getByRole("button", { name: en.invite.password.copy })
    expect(copyBtn).toBeDisabled()
  })

  it("enables copy after reveal and shows oneTime text", async () => {
    const user = userEvent.setup()
    render(<InvitePasswordReveal p12Password="s3cret" />)

    await user.click(screen.getByTestId("scratch-card"))

    const copyBtn = screen.getByRole("button", { name: en.invite.password.copy })
    expect(copyBtn).toBeEnabled()
    expect(screen.getByText(en.invite.password.oneTime)).toBeVisible()
  })

  it("copies password and shows copied text", async () => {
    const user = userEvent.setup()
    render(<InvitePasswordReveal p12Password="s3cret" />)
    await user.click(screen.getByTestId("scratch-card"))

    fireEvent.click(screen.getByRole("button", { name: en.invite.password.copy }))

    // The label flips only once writeText resolves.
    expect(await screen.findByRole("button", { name: en.invite.password.copied })).toBeInTheDocument()
  })

  it("resets copied text after timeout", async () => {
    // shouldAdvanceTime lets the writeText promise settle under fake timers —
    // the copy feedback is now driven by that resolution, not by the click.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<InvitePasswordReveal p12Password="s3cret" />)

    // Use fireEvent (synchronous) to avoid userEvent's internal timers conflicting with fake timers
    fireEvent.click(screen.getByTestId("scratch-card"))
    fireEvent.click(screen.getByRole("button", { name: en.invite.password.copy }))

    expect(await screen.findByRole("button", { name: en.invite.password.copied })).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(screen.getByRole("button", { name: en.invite.password.copy })).toBeInTheDocument()
    vi.useRealTimers()
  })
})
