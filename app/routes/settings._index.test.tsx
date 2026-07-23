import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/auth.server", () => ({
  requireAuth: vi.fn(),
}))
vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))
vi.mock("~/lib/i18n.server", () => ({
  resolveLocale: vi.fn().mockReturnValue("en"),
}))
vi.mock("~/lib/mutations/settings", () => ({
  parseSettingsMutation: vi.fn(),
  handleSettingsMutation: vi.fn(),
}))

import { requireAuth } from "~/lib/auth.server"
import { runEffect } from "~/lib/runtime.server"
import { parseSettingsMutation, handleSettingsMutation } from "~/lib/mutations/settings"
import { action, loader } from "./settings._index"
import { callAction, callLoader, expectData } from "~/test/route-utils"

const mockRequireAuth = vi.mocked(requireAuth)
const mockRunEffect = vi.mocked(runEffect)
const mockParse = vi.mocked(parseSettingsMutation)
const mockHandle = vi.mocked(handleSettingsMutation)

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireAuth.mockResolvedValue({ user: "alice", email: "a@x", sub: "s" } as never)
})

describe("/settings general loader", () => {
  it("packages locale + display prefs into loaderData", async () => {
    mockRunEffect.mockResolvedValue({ locale: "fr", timezone: "Europe/Paris", timeFormat: "24" } as never)
    const result = await callLoader(loader)
    const data = expectData<{
      locale: string
      timezone: string | null
      timeFormat: string | null
      currentLocale: string
    }>(result)
    expect(data.locale).toBe("fr")
    expect(data.timezone).toBe("Europe/Paris")
    expect(data.timeFormat).toBe("24")
    expect(data.currentLocale).toBe("en")
  })
})

describe("/settings general action", () => {
  it("short-circuits with the parser's error shape", async () => {
    mockParse.mockReturnValue({ error: "bad_input" } as never)
    const result = await callAction(action, { formData: { intent: "saveDisplayPrefs" } })
    const data = expectData<{ error?: string }>(result)
    expect(data).toEqual({ error: "bad_input" })
    expect(mockHandle).not.toHaveBeenCalled()
  })

  it("returns the mutation result directly (e.g. saveDisplayPrefs)", async () => {
    mockParse.mockReturnValue({ intent: "saveDisplayPrefs" } as never)
    mockHandle.mockReturnValue("effect" as never)
    mockRunEffect.mockResolvedValue({ displayPrefsSaved: true } as never)
    const result = await callAction(action, { formData: { intent: "saveDisplayPrefs" } })
    const data = expectData<{ displayPrefsSaved?: boolean }>(result)
    expect(data).toEqual({ displayPrefsSaved: true })
  })

  it("converts the saveLocale _redirect+_cookie marker into a 302 Response", async () => {
    mockParse.mockReturnValue({ intent: "saveLocale", locale: "fr" } as never)
    mockHandle.mockReturnValue("effect" as never)
    mockRunEffect.mockResolvedValue({
      _redirect: "/settings",
      _cookie: "duro_lng=fr; Path=/; Max-Age=31536000",
    } as never)
    const result = await callAction(action, { formData: { intent: "saveLocale", locale: "fr" } })
    const res = expectData<Response>(result)
    expect(res).toBeInstanceOf(Response)
    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.headers.get("location")).toBe("/settings")
    expect(res.headers.get("set-cookie")).toContain("duro_lng=fr")
  })
})

// ===========================================================================
// Component-render test
// ===========================================================================

import { screen, waitFor } from "@testing-library/react"
import GeneralSettings from "./settings._index"
import { renderRoute } from "~/test/render-route"
import { t } from "~/test/test-utils"

describe("GeneralSettings component", () => {
  it("renders the language + date/time forms with a live preview", async () => {
    renderRoute({
      route: {
        path: "/settings",
        Component: GeneralSettings as never,
        loader: () => ({ locale: "en", timezone: null, timeFormat: null, currentLocale: "en", theme: "dark" }),
      },
    })
    await waitFor(() => {
      expect(screen.getByText(t("settings.display.heading"))).toBeInTheDocument()
    })
    // Language, Appearance (theme), and Date & time each expose a Save button.
    expect(screen.getByText(t("settings.theme.heading"))).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: /save/i }).length).toBeGreaterThanOrEqual(3)
    expect(screen.getByText(new RegExp(t("settings.display.preview")))).toBeInTheDocument()
  })
})
