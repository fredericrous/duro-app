import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { t } from "~/test/test-utils"

vi.mock("~/lib/i18n.server", () => ({
  resolveLocale: vi.fn((req: Request) => {
    const url = new URL(req.url)
    return url.searchParams.get("locale") ?? "en"
  }),
}))

import { loader, ErrorBoundary } from "./root"

describe("root loader", () => {
  it("resolves the locale from the incoming request", async () => {
    const fakeArgs = {
      request: new Request("http://localhost/?locale=fr"),
      params: {},
      context: {},
    } as unknown as Parameters<typeof loader>[0]
    const data = await loader(fakeArgs)
    expect(data).toEqual({ locale: "fr" })
  })

  it("falls back to 'en' when no locale param is supplied", async () => {
    const fakeArgs = {
      request: new Request("http://localhost/"),
      params: {},
      context: {},
    } as unknown as Parameters<typeof loader>[0]
    const data = await loader(fakeArgs)
    expect(data).toEqual({ locale: "en" })
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
    expect(screen.getByText("Error")).toBeInTheDocument()
    expect(screen.getByText("Internal Server Error")).toBeInTheDocument()
  })

  it("renders the JS Error message when an unhandled Error is thrown", () => {
    renderBoundary(new Error("Something exploded"))
    expect(screen.getByText("Something exploded")).toBeInTheDocument()
  })

  it("renders the generic fallback when error is not a Response or Error", () => {
    renderBoundary("plain string thrown")
    // Plain-string throw falls through to the i18n default — heading is
    // t("error.title"), body is t("error.details").
    expect(screen.getByRole("heading", { name: t("error.title") })).toBeInTheDocument()
    expect(screen.getByText(t("error.details"))).toBeInTheDocument()
  })
})
