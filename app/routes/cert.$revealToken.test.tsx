import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("~/lib/runtime.server", () => ({ runEffect: vi.fn() }))
vi.mock("~/lib/config.server", () => ({
  config: { appName: "Duro", inviteBaseUrl: "https://join.example" },
  isOriginAllowed: vi.fn().mockReturnValue(true),
}))
// ScratchCard wraps a <canvas> (no jsdom 2D context); swap it for a clickable
// shim that fires onReveal — same pattern as InvitePasswordReveal.test.tsx.
vi.mock("~/components/ScratchCard/ScratchCard", () => ({
  ScratchCard: ({ children, onReveal }: { children: React.ReactNode; onReveal: () => void }) => (
    <div data-testid="scratch-card" onClick={onReveal}>
      {children}
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

beforeEach(() => vi.clearAllMocks())

describe("/cert/:revealToken loader", () => {
  it("state=ok → returns the password + email for the scratch card", async () => {
    mockRunEffect.mockResolvedValue({
      state: "ok",
      row: { email: "daddy@example.com", expiresAt: future },
      password: "s3cret-pw",
    } as never)

    const data = expectData<{ valid: boolean; revealed: boolean; email: string; password: string }>(
      await callLoader(revealLoader, { params: { revealToken: "tok" } }),
    )
    expect(data.valid).toBe(true)
    expect(data.revealed).toBe(false)
    expect(data.email).toBe("daddy@example.com")
    expect(data.password).toBe("s3cret-pw")
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
  it("returns revealed:true when the consume succeeds", async () => {
    mockRunEffect.mockResolvedValue(true as never)
    const data = expectData<{ revealed: boolean }>(
      await callAction(revealAction, { params: { revealToken: "tok" }, formData: { intent: "reveal" } }),
    )
    expect(data.revealed).toBe(true)
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

import { screen, waitFor } from "@testing-library/react"
import CertRevealPage from "./cert.$revealToken"
import { renderRoute } from "~/test/render-route"
import { t } from "~/test/test-utils"

const renderReveal = (loaderData: unknown) =>
  renderRoute({
    route: {
      path: "/cert/:revealToken",
      Component: CertRevealPage as never,
      loader: () => loaderData,
      action: () => ({ revealed: true }),
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

  it("renders the scratch card, pre-filled password and download link", async () => {
    renderReveal({
      valid: true,
      revealed: false,
      email: "user@example.com",
      password: "s3cret-pw",
      appName: "Duro",
    })

    await waitFor(() => {
      expect(screen.getByText(t("certReveal.title"))).toBeInTheDocument()
    })
    // PasswordCard renders with the password pre-filled in the scratch-hidden
    // input and the copy addon present.
    expect(screen.getByDisplayValue("s3cret-pw")).toBeInTheDocument()
    expect(screen.getByTestId("scratch-card")).toBeInTheDocument()
    expect(screen.getByText(t("invite.password.copy"))).toBeInTheDocument()
    expect(screen.getByText(t("invite.password.oneTime"))).toBeInTheDocument()
    expect(screen.getByRole("link", { name: t("certReveal.download") })).toHaveAttribute("href", "/cert/tok/download")
  })
})
