import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("~/lib/runtime.server", () => ({ runEffect: vi.fn() }))
vi.mock("~/lib/config.server", () => ({
  config: { appName: "Duro", inviteBaseUrl: "https://join.example" },
  isOriginAllowed: vi.fn().mockReturnValue(true),
}))
// ScratchCard wraps a <canvas> (no jsdom 2D context); swap it for a clickable
// shim that fires onReveal — same pattern as InvitePasswordReveal.test.tsx.
vi.mock("~/components/ScratchCard/ScratchCard", () => ({
  // Two phases, because they are the whole point: `onScratchStart` fires on
  // the first contact (when the password must be fetched) and `onReveal` only
  // once the foil is gone. A mock that fired them together would hide the
  // regression where nothing sits under the foil while you scratch.
  ScratchCard: ({
    children,
    onReveal,
    onScratchStart,
  }: {
    children: React.ReactNode
    onReveal: () => void
    onScratchStart?: () => void
  }) => (
    <div>
      {children}
      <button aria-label="start scratching" onClick={() => onScratchStart?.()} />
      <button
        aria-label="scratch to reveal"
        onClick={() => {
          onScratchStart?.()
          onReveal()
        }}
      />
    </div>
  ),
}))

import { runEffect } from "~/lib/runtime.server"
import { loader as revealLoader, action as revealAction } from "./cert.$revealToken"
import { loader as downloadLoader } from "./cert.$revealToken.download"
import { callLoader, callAction, expectData, expectResponse } from "~/test/route-utils"

const mockRunEffect = vi.mocked(runEffect)
const now = Date.now()
const future = new Date(now + 3600_000).toISOString()

beforeEach(() => {
  vi.clearAllMocks()
  // useScratchReveal persists "scratch:/cert/tok" — without this, a card
  // revealed in one test mounts already-open in the next.
  localStorage.clear()
})

describe("/cert/:revealToken loader", () => {
  it("state=ok → returns email/state but NEVER the password (GETs are secret-free)", async () => {
    mockRunEffect.mockResolvedValue({
      state: "ok",
      row: { email: "daddy@example.com", expiresAt: future },
      password: "s3cret-pw",
    } as never)

    const result = await callLoader(revealLoader, { params: { revealToken: "tok" } })
    const data = expectData<{ valid: boolean; revealed: boolean; email: string }>(result)
    expect(data.valid).toBe(true)
    expect(data.revealed).toBe(false)
    expect(data.email).toBe("daddy@example.com")
    // The enforceable rule: loader data is SSR-serialized and prefetchable, so
    // the one-time password must never appear in it — only the reveal POST
    // (which burns it) may carry it.
    expect(JSON.stringify(data)).not.toContain("s3cret-pw")
    expect("password" in (data as Record<string, unknown>)).toBe(false)
  })

  it("state=revealed → valid but no password (download still offered)", async () => {
    mockRunEffect.mockResolvedValue({
      state: "revealed",
      row: { email: "daddy@example.com", expiresAt: future },
    } as never)

    const data = expectData<{ valid: boolean; revealed: boolean; password?: string }>(
      await callLoader(revealLoader, { params: { revealToken: "tok" } }),
    )
    expect(data.valid).toBe(true)
    expect(data.revealed).toBe(true)
    expect(data.password).toBeUndefined()
  })

  it.each(["invalid", "expired", "consumed"] as const)("state=%s → invalid with matching error", async (state) => {
    mockRunEffect.mockResolvedValue({ state, row: { email: "x", expiresAt: future } } as never)
    const data = expectData<{ valid: boolean; error: string }>(
      await callLoader(revealLoader, { params: { revealToken: "tok" } }),
    )
    expect(data.valid).toBe(false)
    expect(data.error).toBe(state)
  })

  it("missing token → invalid (no runtime call)", async () => {
    const data = expectData<{ valid: boolean; error: string }>(await callLoader(revealLoader, { params: {} }))
    expect(data.valid).toBe(false)
    expect(data.error).toBe("invalid")
    expect(mockRunEffect).not.toHaveBeenCalled()
  })
})

describe("/cert/:revealToken action (reveal POST)", () => {
  it("returns revealed:true AND the password when the consume succeeds — burn and disclose are one transaction", async () => {
    mockRunEffect.mockResolvedValue({ consumed: true, password: "s3cret-pw" } as never)
    const data = expectData<{ revealed: boolean; password: string | null }>(
      await callAction(revealAction, { params: { revealToken: "tok" }, formData: { intent: "reveal" } }),
    )
    expect(data.revealed).toBe(true)
    expect(data.password).toBe("s3cret-pw")
  })

  it("returns no password when the consume fails (already burned, bad token)", async () => {
    mockRunEffect.mockResolvedValue({ consumed: false, password: null } as never)
    const data = expectData<{ revealed: boolean; password: string | null }>(
      await callAction(revealAction, { params: { revealToken: "tok" }, formData: { intent: "reveal" } }),
    )
    expect(data.revealed).toBe(false)
    expect(data.password).toBeNull()
  })

  it("ignores a non-reveal intent without touching the runtime", async () => {
    const data = expectData<{ revealed: boolean }>(
      await callAction(revealAction, { params: { revealToken: "tok" }, formData: { intent: "nope" } }),
    )
    expect(data.revealed).toBe(false)
    expect(mockRunEffect).not.toHaveBeenCalled()
  })
})

describe("/cert/:revealToken/download loader", () => {
  it("streams the P12 as an attachment when present", async () => {
    mockRunEffect.mockResolvedValue(Buffer.from("p12-bytes") as never)
    // Success path RETURNS a Response (route-utils only captures *thrown* ones).
    const res = (await downloadLoader({ params: { revealToken: "tok" } } as never)) as Response
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("application/x-pkcs12")
    expect(res.headers.get("Content-Disposition")).toContain("certificate.p12")
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("p12-bytes")
  })

  it("404s when the cert is gone or the link expired", async () => {
    mockRunEffect.mockResolvedValue(null as never)
    const res = expectResponse(await callLoader(downloadLoader, { params: { revealToken: "tok" } }))
    expect(res.status).toBe(404)
  })
})

// ===========================================================================
// Component-render tests (CertRevealPage + PasswordCard)
// ===========================================================================

import { fireEvent, screen, waitFor } from "@testing-library/react"
import CertRevealPage from "./cert.$revealToken"
import { renderRoute } from "~/test/render-route"
import { t } from "~/test/test-utils"

const renderReveal = (loaderData: unknown) =>
  renderRoute({
    route: {
      path: "/cert/:revealToken",
      Component: CertRevealPage as never,
      loader: () => loaderData,
      action: () => ({ revealed: true, password: "s3cret-pw" }),
    },
    url: "/cert/tok",
  })

describe("CertRevealPage component", () => {
  it.each([
    ["invalid", "certReveal.error.invalid"],
    ["expired", "certReveal.error.expired"],
    ["unknown", "certReveal.error.unknown"],
  ] as const)("renders an error card for the %s state", async (error, key) => {
    renderReveal({ valid: false, error, appName: "Duro" })
    await waitFor(() => {
      expect(screen.getByText(t("certReveal.error.title"))).toBeInTheDocument()
    })
    expect(screen.getByText(t(key))).toBeInTheDocument()
  })

  it("renders the consumed state with its info-toned copy", async () => {
    renderReveal({ valid: false, error: "consumed", appName: "Duro" })
    await waitFor(() => {
      expect(screen.getByText(t("certReveal.error.consumed"))).toBeInTheDocument()
    })
  })

  it("renders the already-revealed state with a download link", async () => {
    renderReveal({ valid: true, revealed: true, email: "user@example.com", appName: "Duro" })
    await waitFor(() => {
      expect(screen.getByText(t("certReveal.revealed.title"))).toBeInTheDocument()
    })
    expect(screen.getByRole("link", { name: t("certReveal.download") })).toHaveAttribute("href", "/cert/tok/download")
  })

  it("renders the scratch card EMPTY — nothing under the foil until the reveal POST answers", async () => {
    renderReveal({
      valid: true,
      revealed: false,
      email: "user@example.com",
      appName: "Duro",
    })

    await waitFor(() => {
      expect(screen.getByText(t("certReveal.title"))).toBeInTheDocument()
    })
    expect(screen.queryByDisplayValue("s3cret-pw")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "scratch to reveal" })).toBeInTheDocument()
    expect(screen.getByText(t("invite.password.copy"))).toBeInTheDocument()
    expect(screen.getByText(t("invite.password.oneTime"))).toBeInTheDocument()
    expect(screen.getByRole("link", { name: t("certReveal.download") })).toHaveAttribute("href", "/cert/tok/download")
  })

  // Drives the whole reveal through a real router: scratch → burn POST →
  // revalidation. Until the react-strict-dom mock cached its element types this
  // could not be tested at all — each re-render remounted the card, which
  // registered a fresh fetcher, which re-rendered, forever.
  it("puts the password under the foil as scratching STARTS, not when it ends", async () => {
    // The regression this guards: moving the secret off the GET made it arrive
    // only after the reveal completed, so you scratched an empty card and then
    // waited. The fetch has to ride the first contact instead.
    renderReveal({ valid: true, revealed: false, email: "user@example.com", appName: "Duro" })

    await screen.findByRole("button", { name: "start scratching" })
    expect(screen.queryByDisplayValue("s3cret-pw")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "start scratching" }))

    // Present behind the foil before the card is anywhere near revealed...
    expect(await screen.findByDisplayValue("s3cret-pw")).toBeInTheDocument()
    // ...while the reveal-gated control stays disabled until the foil is gone.
    expect(screen.getByRole("button", { name: t("invite.password.copy") })).toBeDisabled()
  })

  it("scratch → reveal POST hands out the password, and it survives the burned-loader revalidation", async () => {
    let loaderCalls = 0
    renderRoute({
      route: {
        path: "/cert/:revealToken",
        Component: CertRevealPage as never,
        loader: () =>
          loaderCalls++ === 0
            ? { valid: true, revealed: false, email: "user@example.com", appName: "Duro" }
            : { valid: true, revealed: true, email: "user@example.com", appName: "Duro" },
        action: () => ({ revealed: true, password: "s3cret-pw" }),
      },
      url: "/cert/tok",
    })

    // Nothing secret on screen (or in the DOM) before the scratch.
    await screen.findByRole("button", { name: "scratch to reveal" })
    expect(screen.queryByDisplayValue("s3cret-pw")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "scratch to reveal" }))

    // The reveal POST answered with the password and the loader re-ran burned.
    expect(await screen.findByDisplayValue("s3cret-pw")).toBeInTheDocument()
    await waitFor(() => expect(loaderCalls).toBeGreaterThan(1))

    // The password and its copy button are still on screen for the user to use.
    expect(screen.getByDisplayValue("s3cret-pw")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: t("invite.password.copy") })).toBeEnabled()
    expect(screen.queryByText(t("certReveal.revealed.title"))).not.toBeInTheDocument()
  })
})
