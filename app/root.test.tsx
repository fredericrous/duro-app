import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { t } from "~/test/test-utils"

vi.mock("~/lib/i18n.server", () => ({
  resolveLocale: vi.fn((req: Request) => {
    const url = new URL(req.url)
    return url.searchParams.get("locale") ?? "en"
  }),
}))

const getSessionMock = vi.fn(async (_req: Request) => null as { name: string } | null)
vi.mock("~/lib/session.server", () => ({
  getSession: (req: Request) => getSessionMock(req),
}))

const runEffectMock = vi.fn(async () => null as string | null)
vi.mock("~/lib/runtime.server", () => ({
  runEffect: () => runEffectMock(),
}))

import { loader, ErrorBoundary } from "./root"

const fakeArgs = (request: Request) => ({ request, params: {}, context: {} }) as unknown as Parameters<typeof loader>[0]

describe("root loader", () => {
  it("resolves the locale from the incoming request", async () => {
    const data = await loader(fakeArgs(new Request("http://localhost/?locale=fr")))
    expect(data).toEqual({ locale: "fr", theme: "dark", themePreference: "dark" })
  })

  it("falls back to 'en' when no locale param is supplied", async () => {
    const data = await loader(fakeArgs(new Request("http://localhost/")))
    expect(data).toEqual({ locale: "en", theme: "dark", themePreference: "dark" })
  })

  it("resolves the theme from the cookie", async () => {
    const data = await loader(fakeArgs(new Request("http://localhost/", { headers: { Cookie: "__duro_theme=light" } })))
    expect(data).toMatchObject({ theme: "light", themePreference: "light" })
  })

  it("resolves 'system' against the device scheme cookie", async () => {
    const data = await loader(
      fakeArgs(new Request("http://localhost/", { headers: { Cookie: "__duro_theme=system; __duro_scheme=light" } })),
    )
    expect(data).toMatchObject({ theme: "light", themePreference: "system" })
  })

  it("reads the stored preference for a signed-in user without a theme cookie", async () => {
    getSessionMock.mockResolvedValueOnce({ name: "daddy" })
    runEffectMock.mockResolvedValueOnce("light")
    const result = await loader(fakeArgs(new Request("http://localhost/", { headers: { Cookie: "__duro_session=x" } })))
    // Read-through returns a data() response carrying the theme cookie.
    const response = result as unknown as { data: { theme: string; themePreference: string }; init?: ResponseInit }
    expect(response.data ?? result).toMatchObject({ theme: "light", themePreference: "light" })
  })

  it("never throws for anonymous requests (public routes)", async () => {
    getSessionMock.mockResolvedValueOnce(null)
    const data = await loader(fakeArgs(new Request("http://localhost/recover")))
    expect(data).toMatchObject({ theme: "dark" })
  })
})

describe("root ErrorBoundary", () => {
  const renderBoundary = (error: unknown) => {
    const props = { error, params: {}, loaderData: {} } as unknown as Parameters<typeof ErrorBoundary>[0]
    return render(<ErrorBoundary {...props} />)
  }

  it("renders the 404 message when a Route error response has status 404", () => {
    renderBoundary({
      status: 404,
      statusText: "Not Found",
      data: null,
      internal: false,
    })
    // The 404 branch maps to t("error.404") for the heading + t("error.404msg")
    // for the body. Match by exact translated text — same i18n keys the
    // source code uses.
    expect(screen.getByRole("heading", { name: t("error.404") })).toBeInTheDocument()
    expect(screen.getByText(t("error.404msg"))).toBeInTheDocument()
  })

  it("renders a generic-error message for non-404 route errors", () => {
    renderBoundary({
      status: 500,
      statusText: "Internal Server Error",
      data: null,
      internal: false,
    })
    expect(screen.getByRole("heading", { name: t("error.generic") })).toBeInTheDocument()
    expect(screen.getByText("Internal Server Error")).toBeInTheDocument()
  })

  it("offers a go-home link on every error", () => {
    renderBoundary(new Error("boom"))
    expect(screen.getByRole("link", { name: t("error.goHome") })).toHaveAttribute("href", "/")
  })

  it("renders the JS Error message when an unhandled Error is thrown (non-production)", () => {
    renderBoundary(new Error("Something exploded"))
    expect(screen.getByText("Something exploded")).toBeInTheDocument()
  })

  it("hides the raw Error message in production (no internal leak)", () => {
    vi.stubEnv("NODE_ENV", "production")
    try {
      renderBoundary(new Error("secret db connection string leaked"))
      expect(screen.queryByText("secret db connection string leaked")).not.toBeInTheDocument()
      expect(screen.getByText(t("error.details"))).toBeInTheDocument()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it("renders the generic fallback when error is not a Response or Error", () => {
    renderBoundary("plain string thrown")
    // Plain-string throw falls through to the i18n default — heading is
    // t("error.title"), body is t("error.details").
    expect(screen.getByRole("heading", { name: t("error.title") })).toBeInTheDocument()
    expect(screen.getByText(t("error.details"))).toBeInTheDocument()
  })
})
