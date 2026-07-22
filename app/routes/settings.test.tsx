import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/auth.server", () => ({
  requireAuth: vi.fn(),
}))
vi.mock("~/lib/config.server", () => ({
  config: { autheliaUrl: "https://auth.example.com" },
}))

import { requireAuth } from "~/lib/auth.server"
import { loader } from "./settings"
import { callLoader, expectData } from "~/test/route-utils"

const mockRequireAuth = vi.mocked(requireAuth)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("/settings layout loader", () => {
  it("exposes hasSecurity from the Authelia config", async () => {
    mockRequireAuth.mockResolvedValue({ user: "alice" } as never)
    const result = await callLoader(loader)
    const data = expectData<{ hasSecurity: boolean }>(result)
    expect(data.hasSecurity).toBe(true)
  })
})

// ===========================================================================
// Component-render test — the settings chrome (section nav + outlet)
// ===========================================================================

import { screen, waitFor } from "@testing-library/react"
import SettingsLayout from "./settings"
import { renderRoute } from "~/test/render-route"
import { t } from "~/test/test-utils"

const renderLayout = (hasSecurity: boolean) =>
  renderRoute({
    parentLoaderId: "routes/dashboard",
    parentLoader: () => ({ user: "alice", isAdmin: false }),
    route: {
      path: "/settings",
      Component: SettingsLayout as never,
      loader: () => ({ hasSecurity }),
    },
  })

describe("SettingsLayout component", () => {
  it("renders a section item per settings page (incl. Security when configured)", async () => {
    renderLayout(true)
    await waitFor(() => {
      expect(screen.getByRole("button", { name: t("settings.nav.general", "General") })).toBeInTheDocument()
    })
    expect(screen.getByRole("button", { name: t("settings.nav.certificate", "Certificate") })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: t("settings.nav.apiKeys", "API keys") })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: t("settings.nav.security", "Security") })).toBeInTheDocument()
  })

  it("hides the Security item when no portal is configured", async () => {
    renderLayout(false)
    await waitFor(() => {
      expect(screen.getByRole("button", { name: t("settings.nav.general", "General") })).toBeInTheDocument()
    })
    expect(screen.queryByRole("button", { name: t("settings.nav.security", "Security") })).not.toBeInTheDocument()
  })
})
