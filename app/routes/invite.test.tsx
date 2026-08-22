import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))
vi.mock("~/lib/config.server", () => ({
  config: { appName: "Duro", homeUrl: "https://duro.example.com" },
  isOriginAllowed: vi.fn().mockReturnValue(true),
}))
vi.mock("~/lib/crypto.server", () => ({
  hashToken: vi.fn().mockReturnValue("hashed-token"),
}))
vi.mock("~/lib/i18n.server", () => ({
  resolveLocale: vi.fn().mockReturnValue("en"),
  localeCookieHeader: vi.fn(),
}))

import { runEffect } from "~/lib/runtime.server"
import { action, loader } from "./invite"
import { callAction, callLoader, expectData } from "~/test/route-utils"

const mockRunEffect = vi.mocked(runEffect)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("/invite/:token loader", () => {
  it("returns missing_token error when params.token is absent", async () => {
    const result = await callLoader(loader, { params: {} })
    const data = expectData<{ valid: boolean; error: string }>(result)
    expect(data.valid).toBe(false)
    expect(data.error).toBe("missing_token")
  })

  it("returns invalid error when no invite matches the token hash", async () => {
    mockRunEffect.mockResolvedValue({ invite: null, p12Password: null } as never)

    const result = await callLoader(loader, { params: { token: "abc" } })
    const data = expectData<{ valid: boolean; error: string }>(result)
    expect(data.valid).toBe(false)
    expect(data.error).toBe("invalid")
  })

  it("redirects an accepted invite to the app instead of a dead-end card", async () => {
    // The account exists — whoever opened this link wants in, not an
    // explanation that they already joined.
    mockRunEffect.mockResolvedValue({
      invite: {
        id: "i1",
        usedAt: "2026-01-01T00:00:00Z",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        locale: null,
        status: { _tag: "Accepted", usedAt: "2026-01-01T00:00:00Z", usedBy: "alice" },
      },
      p12Password: "pw",
    } as never)

    const result = await callLoader(loader, { params: { token: "abc" } })
    expect(result.kind).toBe("response")
    if (result.kind === "response") {
      expect(result.response.status).toBe(302)
      expect(result.response.headers.get("location")).toBe("https://duro.example.com")
    }
  })

  it("explains a revoked invite rather than sending it to the app", async () => {
    // Revoked means there is no account to reach, so redirecting would dump
    // the visitor on a login screen they can never pass.
    mockRunEffect.mockResolvedValue({
      invite: {
        id: "i1",
        usedAt: "2026-01-01T00:00:00Z",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        locale: null,
        status: { _tag: "Revoked" },
      },
      p12Password: null,
    } as never)

    const result = await callLoader(loader, { params: { token: "abc" } })
    const data = expectData<{ valid: boolean; error: string }>(result)
    expect(data.valid).toBe(false)
    expect(data.error).toBe("revoked")
  })

  it("returns expired when invite has passed expiresAt", async () => {
    mockRunEffect.mockResolvedValue({
      invite: {
        id: "i1",
        usedAt: null,
        expiresAt: new Date(Date.now() - 86400000).toISOString(),
        locale: null,
        status: { _tag: "Pending", certIssued: true, emailSent: true, certVerified: false },
      },
      p12Password: "pw",
    } as never)

    const result = await callLoader(loader, { params: { token: "abc" } })
    const data = expectData<{ valid: boolean; error: string }>(result)
    expect(data.valid).toBe(false)
    expect(data.error).toBe("expired")
  })

  it("returns the welcome data when the invite is fresh + unused", async () => {
    mockRunEffect.mockResolvedValue({
      invite: {
        id: "i-fresh",
        email: "alice@example.com",
        usedAt: null,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        locale: null,
        status: { _tag: "Pending", certIssued: true, emailSent: true, certVerified: false },
        groups: "[1, 2]",
        groupNames: '["family", "media"]',
      },
      p12Password: "ThisIsTheP12Password!",
    } as never)
    const result = await callLoader(loader, { params: { token: "abc" } })
    const data = expectData<{
      valid: boolean
      email?: string
      hasPassword?: boolean
      groupNames?: string[]
    }>(result)
    expect(data.valid).toBe(true)
    expect(data.email).toBe("alice@example.com")
    // Existence only — the password itself never rides the loader (GET data
    // is SSR-serialized and prefetchable); disclosure is the reveal POST's.
    expect(data.hasPassword).toBe(true)
    expect(JSON.stringify(data)).not.toContain("ThisIsTheP12Password!")
    expect(data.groupNames).toEqual(["family", "media"])
  })

  it("returns the 'unknown' error fallback when runEffect throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    mockRunEffect.mockRejectedValueOnce(new Error("DB down") as never)
    const result = await callLoader(loader, { params: { token: "abc" } })
    const data = expectData<{ valid: boolean; error: string }>(result)
    expect(data.valid).toBe(false)
    expect(data.error).toBe("unknown")
    err.mockRestore()
  })
})

describe("/invite/:token action", () => {
  beforeEach(async () => {
    // isOriginAllowed leaks between tests — restore the default before each.
    const { isOriginAllowed } = await import("~/lib/config.server")
    vi.mocked(isOriginAllowed).mockReturnValue(true)
  })

  it("returns the 'Missing invite token' error shape when params.token is absent", async () => {
    const result = await callAction(action, { params: {} })
    const data = expectData<{ error?: string }>(result)
    expect(data.error).toBe("Missing invite token")
  })

  it("returns the origin-blocked error when isOriginAllowed=false", async () => {
    const { isOriginAllowed } = await import("~/lib/config.server")
    vi.mocked(isOriginAllowed).mockReturnValue(false)

    const result = await callAction(action, {
      params: { token: "t1" },
      formData: { intent: "reveal" },
      headers: { Origin: "http://evil" },
    })
    const data = expectData<{ error?: string }>(result)
    expect(data.error).toBe("Invalid request origin")
  })

  it("hands out the password for intent=reveal against a still-valid invite", async () => {
    mockRunEffect.mockResolvedValue("ThisIsTheP12Password!" as never)
    const result = await callAction(action, {
      params: { token: "t1" },
      formData: { intent: "reveal" },
    })
    const data = expectData<{ revealed?: boolean; p12Password?: string | null }>(result)
    expect(data.revealed).toBe(true)
    expect(data.p12Password).toBe("ThisIsTheP12Password!")
  })

  it("hands out nothing when the invite is no longer valid (consumed/expired/attempts)", async () => {
    mockRunEffect.mockResolvedValue(null as never)
    const result = await callAction(action, {
      params: { token: "t1" },
      formData: { intent: "reveal" },
    })
    const data = expectData<{ revealed?: boolean; p12Password?: string | null }>(result)
    expect(data.revealed).toBe(false)
    expect(data.p12Password).toBeNull()
  })

  it("returns the unknown-action error shape for any other intent", async () => {
    const result = await callAction(action, {
      params: { token: "t1" },
      formData: { intent: "unrecognized" },
    })
    const data = expectData<{ error?: string }>(result)
    expect(data.error).toBe("Unknown action")
  })
})

// =============================================================================
// Component-render tests
// =============================================================================

import { screen, waitFor } from "@testing-library/react"
import InvitePage from "./invite"
import { renderRoute } from "~/test/render-route"
import { server, http, HttpResponse } from "~/test/msw-server"
import { t } from "~/test/test-utils"

// InvitePage mounts a CertCheck that probes /health to detect whether the
// browser already has the user's client cert installed. Without a handler
// MSW errors on the unmatched GET — register a passthrough 200 so the
// useEffect doesn't blow up the test.
beforeEach(() => {
  server.use(http.get("/health", () => HttpResponse.json({ ok: true })))
})

const renderInvite = (loaderData: unknown, url = "/invite/abc") =>
  renderRoute({
    route: {
      path: "/invite/:token",
      Component: InvitePage as never,
      loader: () => loaderData,
    },
    url,
  })

describe("InvitePage component", () => {
  it("renders the missing-token error card when the loader returned missing_token", async () => {
    renderInvite({ valid: false, error: "missing_token", appName: "Duro", healthUrl: "/health" })
    // The ErrorCard for missing_token uses t("invite.error.title") as the
    // heading. Assert the exact translated text — same i18n key the source
    // resolves on render.
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: t("invite.error.title") })).toBeInTheDocument()
    })
  })

  it("renders the expired-card with reinvite link when error is `expired`", async () => {
    renderInvite({ valid: false, error: "expired", appName: "Duro", healthUrl: "/health" }, "/invite/tok-1")
    // Expired branch uses t("invite.expired.title") for the heading + a
    // "request a new invite" link pointing at /reinvite/<token>.
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: t("invite.expired.title") })).toBeInTheDocument()
    })
    expect(screen.getByRole("link")).toHaveAttribute("href", "/reinvite/tok-1")
  })

  it("renders the no-longer-valid card for a spent or revoked invite", async () => {
    renderInvite({ valid: false, error: "revoked", appName: "Duro", healthUrl: "/health" })
    // An accepted invite redirects in the loader, so anything reaching this
    // branch has no account behind it — info tone, no CTA to offer.
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: t("invite.revoked.title") })).toBeInTheDocument()
    })
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
  })

  it("renders the welcome view when the invite is valid", async () => {
    renderInvite({
      valid: true,
      appName: "Duro",
      email: "alice@example.com",
      groupNames: ["Media Team"],
      hasPassword: true,
      healthUrl: "/health",
    })
    // The valid branch uses t("invite.title", { appName }) for the page
    // heading — assert the exact rendered string.
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: t("invite.title", undefined, { appName: "Duro" }) }),
      ).toBeInTheDocument()
    })
    // Email is interpolated into the subtitle <Trans>; node tree may wrap it
    // in <strong> + ancestors, so a function matcher is the right tool.
    expect(
      screen.getByText((_, node) => node?.tagName === "P" && Boolean(node.textContent?.includes("alice@example.com"))),
    ).toBeInTheDocument()
  })
})
