import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect } from "effect"

// Mock the server seams so the loader/action run without the full AppLayer.
// `config` is a mutable object so individual tests can flip recoveryEnabled.
vi.mock("~/lib/config.server", () => ({
  config: { recoveryEnabled: true, appName: "Duro" },
  isOriginAllowed: vi.fn().mockReturnValue(true),
}))
vi.mock("~/lib/runtime.server", () => ({ runEffect: vi.fn().mockResolvedValue(undefined) }))
vi.mock("~/lib/workflows/recovery.server", () => ({
  requestRecovery: vi.fn(() => Effect.succeed(undefined)),
}))

import { screen, waitFor } from "@testing-library/react"
import RecoverPage, { loader, action, meta } from "./recover"
import { config, isOriginAllowed } from "~/lib/config.server"
import { requestRecovery } from "~/lib/workflows/recovery.server"
import { runEffect } from "~/lib/runtime.server"
import { renderRoute } from "~/test/render-route"
import { callLoader, callAction, expectData, expectResponse } from "~/test/route-utils"
import { t } from "~/test/test-utils"

const mockOrigin = vi.mocked(isOriginAllowed)
const mockRequest = vi.mocked(requestRecovery)
const mockRunEffect = vi.mocked(runEffect)

// `config` is typed readonly (`as const`); the mock supplies a plain object,
// so cast to a mutable view to flip recoveryEnabled per test.
const cfg = config as unknown as { recoveryEnabled: boolean; appName: string }

beforeEach(() => {
  vi.clearAllMocks()
  cfg.recoveryEnabled = true
  mockOrigin.mockReturnValue(true)
  mockRequest.mockImplementation(() => Effect.succeed(undefined) as never)
  mockRunEffect.mockResolvedValue(undefined as never)
})

describe("recover meta", () => {
  it("includes the app name when provided", () => {
    expect(meta({ data: { appName: "Duro" } } as never)).toEqual([{ title: "Recover access — Duro" }])
  })

  it("falls back to a generic title without data", () => {
    expect(meta({ data: undefined } as never)).toEqual([{ title: "Recover access" }])
  })
})

describe("recover loader", () => {
  it("returns the app name when recovery is enabled", async () => {
    const data = expectData<{ appName: string }>(await callLoader(loader))
    expect(data.appName).toBe("Duro")
  })

  it("404s when recovery is disabled", async () => {
    cfg.recoveryEnabled = false
    expect(expectResponse(await callLoader(loader)).status).toBe(404)
  })
})

describe("recover action", () => {
  it("404s when recovery is disabled", async () => {
    cfg.recoveryEnabled = false
    expect(expectResponse(await callAction(action, { formData: { email: "a@b.c" } })).status).toBe(404)
  })

  it("rejects a disallowed origin", async () => {
    mockOrigin.mockReturnValue(false)
    const data = expectData<{ error?: string }>(await callAction(action, { formData: { email: "a@b.c" } }))
    expect(data.error).toBe("Invalid request origin")
    expect(mockRunEffect).not.toHaveBeenCalled()
  })

  it("requires an email", async () => {
    const data = expectData<{ error?: string }>(await callAction(action, { formData: { email: "  " } }))
    expect(data.error).toBe("Email is required")
    expect(mockRunEffect).not.toHaveBeenCalled()
  })

  it("submits and returns the generic outcome, parsing IP from x-forwarded-for", async () => {
    const data = expectData<{ submitted?: boolean }>(
      await callAction(action, {
        formData: { email: "user@example.com", note: "lost laptop" },
        headers: { "x-forwarded-for": "9.9.9.9, 1.1.1.1" },
      }),
    )
    expect(data.submitted).toBe(true)
    expect(mockRequest).toHaveBeenCalledWith({
      email: "user@example.com",
      note: "lost laptop",
      requestIp: "9.9.9.9",
    })
    expect(mockRunEffect).toHaveBeenCalledOnce()
  })

  it("falls back to x-real-ip and nulls an empty note", async () => {
    const data = expectData<{ submitted?: boolean }>(
      await callAction(action, {
        formData: { email: "user@example.com", note: "   " },
        headers: { "x-real-ip": "2.2.2.2" },
      }),
    )
    expect(data.submitted).toBe(true)
    expect(mockRequest).toHaveBeenCalledWith({
      email: "user@example.com",
      note: null,
      requestIp: "2.2.2.2",
    })
  })
})

// RecoverPage only reads `actionData`; cast to a permissive prop shape so the
// wrappers can inject it without React Router's generated ComponentProps type.
const PageAny = RecoverPage as unknown as (props: { loaderData?: unknown; actionData: unknown }) => React.ReactElement

describe("RecoverPage", () => {
  it("renders the recovery request form", async () => {
    renderRoute({
      route: {
        path: "/recover",
        Component: RecoverPage as never,
        loader: () => ({ appName: "Duro" }),
        action: () => ({ submitted: true }),
      },
    })

    await waitFor(() => {
      expect(screen.getByRole("button", { name: t("recover.submit") })).toBeInTheDocument()
    })
    expect(screen.getByText(t("recover.title"))).toBeInTheDocument()
    expect(screen.getByPlaceholderText(t("recover.emailPlaceholder"))).toBeInTheDocument()
  })

  it("renders the success confirmation after submission", async () => {
    const Wrapper = (props: { loaderData: unknown }) => (
      <PageAny loaderData={props.loaderData} actionData={{ submitted: true }} />
    )
    renderRoute({
      route: { path: "/recover", Component: Wrapper as never, loader: () => ({ appName: "Duro" }) },
    })
    await waitFor(() => {
      expect(screen.getByText(t("recover.sent.title"))).toBeInTheDocument()
    })
    expect(screen.getByText(t("recover.sent.message"))).toBeInTheDocument()
  })

  it("surfaces an action error in an alert", async () => {
    const Wrapper = (props: { loaderData: unknown }) => (
      <PageAny loaderData={props.loaderData} actionData={{ error: "Invalid request origin" }} />
    )
    renderRoute({
      route: { path: "/recover", Component: Wrapper as never, loader: () => ({ appName: "Duro" }) },
    })
    await waitFor(() => {
      expect(screen.getByText("Invalid request origin")).toBeInTheDocument()
    })
  })
})
