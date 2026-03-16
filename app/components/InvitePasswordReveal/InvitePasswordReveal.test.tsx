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

    expect(screen.getByRole("button", { name: en.invite.password.copied })).toBeInTheDocument()
  })

  it("resets copied text after timeout", async () => {
    vi.useFakeTimers()
    render(<InvitePasswordReveal p12Password="s3cret" />)

    // Use fireEvent (synchronous) to avoid userEvent's internal timers conflicting with fake timers
    fireEvent.click(screen.getByTestId("scratch-card"))
    fireEvent.click(screen.getByRole("button", { name: en.invite.password.copy }))

    expect(screen.getByRole("button", { name: en.invite.password.copied })).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(screen.getByRole("button", { name: en.invite.password.copy })).toBeInTheDocument()
    vi.useRealTimers()
  })
})
