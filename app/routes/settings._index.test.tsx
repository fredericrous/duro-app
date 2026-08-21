import { describe, expect, it, vi, beforeEach } from "vitest"
import { Effect } from "effect"

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
    // The action pipes the handler through Effect.orDie, so the mock must
    // return a real (pipeable) Effect; the mocked runEffect yields the result.
    mockHandle.mockReturnValue(Effect.void as never)
    mockRunEffect.mockResolvedValue({ displayPrefsSaved: true } as never)
    const result = await callAction(action, { formData: { intent: "saveDisplayPrefs" } })
    const data = expectData<{ displayPrefsSaved?: boolean }>(result)
    expect(data).toEqual({ displayPrefsSaved: true })
  })

  it("converts the saveLocale _redirect+_cookie marker into a 302 Response", async () => {
    mockParse.mockReturnValue({ intent: "saveLocale", locale: "fr" } as never)
    mockHandle.mockReturnValue(Effect.void as never)
    mockRunEffect.mockResolvedValue({
      _redirect: "/settings",
      _cookie: "duro_lng=fr; Path=/; Max-Age=31536000",
    } as never)
    const result = await callAction(action, { formData: { intent: "saveLocale", locale: "fr" } })
    const res = expectData<Response>(result)
    expect(res).toBeInstanceOf(Response)
    expect(res.status).toBeGreaterThanOrEqual(300)
    // ?saved=1 carries the acknowledgement across the reload the cookie needs.
    expect(res.headers.get("location")).toBe("/settings?saved=1")
    expect(res.headers.get("set-cookie")).toContain("duro_lng=fr")
  })
})

// ===========================================================================
// Component-render test
// ===========================================================================

import { fireEvent, screen, waitFor } from "@testing-library/react"
import GeneralSettings from "./settings._index"
import { renderRoute } from "~/test/render-route"
import { t } from "~/test/test-utils"

describe("GeneralSettings component", () => {
  it("renders the language + date/time forms with a live preview", async () => {
    renderRoute({
      route: {
        path: "/settings",
        Component: GeneralSettings as never,
        loader: () => ({
          locale: "en",
          timezone: null,
          timeFormat: null,
          currentLocale: "en",
          theme: "system",
          openLinksInNewTab: false,
        }),
      },
    })
    await waitFor(() => {
      expect(screen.getByText(t("settings.display.heading"))).toBeInTheDocument()
    })
    // Preferences save on change — no Save buttons anywhere on the page.
    expect(screen.getByText(t("settings.theme.heading"))).toBeInTheDocument()
    expect(screen.queryAllByRole("button", { name: /save/i })).toHaveLength(0)
    expect(screen.getByText(new RegExp(t("settings.display.preview")))).toBeInTheDocument()
    // The system (follow device) preference renders both as the selected
    // trigger label (via initialLabels) and as a popup option.
    expect(screen.getAllByText(t("settings.theme.system")).length).toBeGreaterThanOrEqual(1)
  })

  it("saves a display preference as soon as it changes, and says so", async () => {
    const submitted: Record<string, string>[] = []
    renderRoute({
      route: {
        path: "/settings",
        Component: GeneralSettings as never,
        loader: () => ({
          locale: "en",
          timezone: null,
          timeFormat: null,
          currentLocale: "en",
          theme: "system",
          openLinksInNewTab: false,
        }),
        action: async ({ request }: { request: Request }) => {
          const fd = await request.formData()
          submitted.push(Object.fromEntries(fd) as Record<string, string>)
          return { displayPrefsSaved: true }
        },
      },
    })
    await waitFor(() => {
      expect(screen.getByText(t("settings.display.heading"))).toBeInTheDocument()
    })

    // Open the time-format select and pick the 24h option.
    fireEvent.click(screen.getByText(t("settings.display.timeFormatLabel")).closest("div")!.querySelector("button")!)
    const option = await screen.findByText(t("settings.display.timeFormat.24"))
    fireEvent.click(option)

    // No Save button was involved — the change itself is the submit.
    await waitFor(() => expect(submitted.length).toBeGreaterThan(0))
    expect(submitted[0].intent).toBe("saveDisplayPrefs")
    expect(submitted[0].timeFormat).toBe("24")

    expect(await screen.findByText(t("settings.saved"))).toBeInTheDocument()
  })

  it("saves the link-target preference the moment the switch flips", async () => {
    const submitted: Record<string, string>[] = []
    renderRoute({
      route: {
        path: "/settings",
        Component: GeneralSettings as never,
        loader: () => ({
          locale: "en",
          timezone: null,
          timeFormat: null,
          currentLocale: "en",
          theme: "system",
          openLinksInNewTab: false,
        }),
        action: async ({ request }: { request: Request }) => {
          const fd = await request.formData()
          submitted.push(Object.fromEntries(fd) as Record<string, string>)
          return { openInNewTabSaved: true }
        },
      },
    })

    fireEvent.click(await screen.findByRole("switch", { name: t("settings.links.newTabLabel") }))

    await waitFor(() => expect(submitted.length).toBeGreaterThan(0))
    expect(submitted[0].intent).toBe("saveOpenInNewTab")
    // The literal string the parser demands — this assertion and the parser
    // test meet in the middle, so a change to either encoding breaks a test
    // rather than silently persisting the wrong value.
    expect(submitted[0].openInNewTab).toBe("true")

    expect(await screen.findByText(t("settings.saved"))).toBeInTheDocument()
  })

  it("announces the save that language and theme complete after their reload", async () => {
    renderRoute({
      route: {
        path: "/settings",
        Component: GeneralSettings as never,
        loader: () => ({
          locale: "en",
          timezone: null,
          timeFormat: null,
          currentLocale: "en",
          theme: "system",
          openLinksInNewTab: false,
        }),
      },
      url: "/settings?saved=1",
    })
    // Those two set a cookie and reload the document, so the acknowledgement
    // rides in the URL — nothing queued client-side survives that navigation.
    expect(await screen.findByText(t("settings.saved"))).toBeInTheDocument()
  })

  it("shows the save in flight, then swaps it for the acknowledgement", async () => {
    let release: (() => void) | undefined
    renderRoute({
      route: {
        path: "/settings",
        Component: GeneralSettings as never,
        loader: () => ({
          locale: "en",
          timezone: null,
          timeFormat: null,
          currentLocale: "en",
          theme: "system",
          openLinksInNewTab: false,
        }),
        action: async () => {
          // Hold the request open so the pending state is observable — on a
          // fast link it would otherwise be gone before the assertion runs.
          await new Promise<void>((resolve) => {
            release = resolve
          })
          return { displayPrefsSaved: true }
        },
      },
    })
    await waitFor(() => {
      expect(screen.getByText(t("settings.display.heading"))).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText(t("settings.display.timeFormatLabel")).closest("div")!.querySelector("button")!)
    fireEvent.click(await screen.findByText(t("settings.display.timeFormat.24")))

    // In flight: the waiting message occupies the slot, and the success one
    // must not be there yet.
    expect(await screen.findByText(t("settings.saving"))).toBeInTheDocument()
    expect(screen.queryByText(t("settings.saved"))).not.toBeInTheDocument()

    release!()
    expect(await screen.findByText(t("settings.saved"))).toBeInTheDocument()
    expect(screen.queryByText(t("settings.saving"))).not.toBeInTheDocument()
  })

  it("stays quiet until something is actually saved", async () => {
    renderRoute({
      route: {
        path: "/settings",
        Component: GeneralSettings as never,
        loader: () => ({
          locale: "en",
          timezone: null,
          timeFormat: null,
          currentLocale: "en",
          theme: "system",
          openLinksInNewTab: false,
        }),
      },
    })
    await waitFor(() => {
      expect(screen.getByText(t("settings.display.heading"))).toBeInTheDocument()
    })
    expect(screen.queryByText(t("settings.saved"))).not.toBeInTheDocument()
  })
})
