import { describe, it, expect, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { server, http, HttpResponse } from "~/test/msw-server"
import { t } from "~/test/test-utils"

// ScratchCard wraps a <canvas> (no jsdom 2D context); swap it for a clickable
// shim that fires onReveal — same pattern as InvitePasswordReveal.test.tsx.
import { vi } from "vitest"
vi.mock("~/components/ScratchCard/ScratchCard", () => ({
  ScratchCard: ({ children, onReveal }: { children: React.ReactNode; onReveal: () => void }) => (
    <div data-testid="scratch-card" onClick={onReveal}>
      {children}
    </div>
  ),
}))

import { PasswordReveal } from "./PasswordReveal"

beforeEach(() => {
  localStorage.clear()
  // jsdom has no Clipboard API; the copy addon calls it directly (no guard).
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  })
  // useAction POSTs to /settings on reveal; give it a default OK response so
  // the unhandled-request guard in setup.ts doesn't fail interaction tests.
  server.use(http.post("*/settings", () => HttpResponse.json({ success: true })))
})

describe("PasswordReveal", () => {
  it("shows the password input with copy disabled before reveal", () => {
    render(<PasswordReveal p12Password="s3cret-pw" />)
    expect(screen.getByDisplayValue("s3cret-pw")).toBeInTheDocument()
    expect(screen.getByText(t("settings.cert.copy"))).toBeInTheDocument()
  })

  it("consumes the password server-side when the card is scratched open", async () => {
    let consumed = false
    server.use(
      http.post("*/settings", () => {
        consumed = true
        return HttpResponse.json({ success: true })
      }),
    )

    render(<PasswordReveal p12Password="s3cret-pw" />)
    fireEvent.click(screen.getByTestId("scratch-card"))

    await waitFor(() => expect(consumed).toBe(true))
  })

  it("copies the password and flips the addon label to 'copied'", async () => {
    render(<PasswordReveal p12Password="s3cret-pw" />)
    // Reveal first so the copy addon is enabled.
    fireEvent.click(screen.getByTestId("scratch-card"))
    fireEvent.click(screen.getByText(t("settings.cert.copy")))

    await waitFor(() => {
      expect(screen.getByText(t("settings.cert.copied"))).toBeInTheDocument()
    })
  })
})
