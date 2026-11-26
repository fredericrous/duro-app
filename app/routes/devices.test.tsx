import { describe, expect, it, vi, beforeEach } from "vitest"
import { Effect } from "effect"
import { readFileSync } from "node:fs"
import { join } from "node:path"

vi.mock("~/lib/auth.server", () => ({
  requireAuth: vi.fn(),
}))
vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))
vi.mock("~/lib/mutations/settings", () => ({
  parseSettingsMutation: vi.fn(),
  handleSettingsMutation: vi.fn(),
}))
vi.mock("~/lib/config.server", () => ({
  isOriginAllowed: vi.fn().mockReturnValue(true),
}))
// The lookup itself is tested in presented-cert.server.test.ts; here only
// what the loader hands it and does with its answer.
vi.mock("~/lib/workflows/presented-cert.server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("~/lib/workflows/presented-cert.server")>()
  return { ...mod, presentedRevokedNotice: vi.fn(() => Effect.succeed(null)) }
})

import { requireAuth } from "~/lib/auth.server"
import { runEffect } from "~/lib/runtime.server"
import { parseSettingsMutation, handleSettingsMutation } from "~/lib/mutations/settings"
import { isOriginAllowed } from "~/lib/config.server"
import { presentedRevokedNotice } from "~/lib/workflows/presented-cert.server"
import { data } from "react-router"
import { action, loader } from "./devices"
import { callAction, callLoader, expectData } from "~/test/route-utils"

const mockRequireAuth = vi.mocked(requireAuth)
const mockRunEffect = vi.mocked(runEffect)
const mockParse = vi.mocked(parseSettingsMutation)
const mockHandle = vi.mocked(handleSettingsMutation)
const mockOrigin = vi.mocked(isOriginAllowed)

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireAuth.mockResolvedValue({ user: "alice", email: "a@example.com", sub: "s" } as never)
  mockOrigin.mockReturnValue(true)
})

describe("/devices loader", () => {
  it("packages email + device budget + certificates", async () => {
    const budget = { used: 1, limit: 3, nextAvailable: null }
    mockRunEffect.mockResolvedValue({ budget, certificates: [{ id: "c1" }] } as never)
    const result = await callLoader(loader)
    const data = expectData<{ email: string; budget: typeof budget; certificates: unknown[] }>(result)
    expect(data.email).toBe("a@example.com")
    expect(data.budget).toEqual(budget)
    expect(data.certificates).toEqual([{ id: "c1" }])
    // The one-time password is never handed to this page — it is revealed from
    // the emailed link only.
    expect(data).not.toHaveProperty("p12Password")
  })
})

describe("/devices loader: the certificate this device presented", () => {
  const budget = { used: 0, limit: 3, nextAvailable: null }
  const XFCC_HEADER = "x-forwarded-client-cert"
  // client-cert-fixture.pem canonicalizes to serial "a1b2c3d4e5f". This file
  // runs under jsdom, where import.meta.url is not a file URL.
  const FIXTURE_XFCC = `Cert="${encodeURIComponent(
    readFileSync(join(process.cwd(), "app/test/fixtures/client-cert-fixture.pem"), "utf8"),
  )}"`
  const notice = { revokedAt: "2026-09-23T16:22:23.000Z", label: null }

  it("asks the lookup with the request's XFCC and the signed-in user", async () => {
    mockRunEffect.mockResolvedValue({ budget, certificates: [], pendingClaim: null, presentedRevoked: null } as never)
    await callLoader(loader, { headers: { [XFCC_HEADER]: 'Cert="x"' } })
    expect(vi.mocked(presentedRevokedNotice)).toHaveBeenCalledWith('Cert="x"', "alice")
  })

  it("asks with no XFCC when the request has none, and passes null through", async () => {
    mockRunEffect.mockResolvedValue({ budget, certificates: [], pendingClaim: null, presentedRevoked: null } as never)
    const loaderData = expectData<{ presentedRevoked: unknown }>(await callLoader(loader))
    expect(vi.mocked(presentedRevokedNotice)).toHaveBeenCalledWith(null, "alice")
    expect(loaderData.presentedRevoked).toBeNull()
  })

  /** The class React Router's data() returns (its type export has no runtime value). */
  const DataWithInit = data(null).constructor as new (...args: never[]) => { data: unknown; init: ResponseInit | null }
  /** The loader's answer, unwrapped when it came back through data() with headers. */
  const unwrap = (value: unknown) =>
    value instanceof DataWithInit ? { payload: value.data, init: value.init } : { payload: value, init: null }

  it("sets the once-a-day cookie when it shows the notice", async () => {
    mockRunEffect.mockResolvedValue({ budget, certificates: [], pendingClaim: null, presentedRevoked: notice } as never)
    const { payload, init } = unwrap(expectData(await callLoader(loader, { headers: { [XFCC_HEADER]: FIXTURE_XFCC } })))
    expect((payload as { presentedRevoked: unknown }).presentedRevoked).toEqual(notice)
    expect(new Headers(init?.headers).get("Set-Cookie")).toBe(
      "duro_revoked_notice=a1b2c3d4e5f; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax",
    )
  })

  it("does not set it again when it already holds that serial, nor with no notice", async () => {
    mockRunEffect.mockResolvedValue({ budget, certificates: [], pendingClaim: null, presentedRevoked: notice } as never)
    const again = unwrap(
      expectData(
        await callLoader(loader, {
          headers: { [XFCC_HEADER]: FIXTURE_XFCC, cookie: "duro_revoked_notice=a1b2c3d4e5f" },
        }),
      ),
    )
    expect(again.init).toBeNull()

    mockRunEffect.mockResolvedValue({ budget, certificates: [], pendingClaim: null, presentedRevoked: null } as never)
    const none = unwrap(expectData(await callLoader(loader, { headers: { [XFCC_HEADER]: FIXTURE_XFCC } })))
    expect(none.init).toBeNull()
  })
})

describe("/devices action", () => {
  it("rejects a cross-origin post before touching the mutation", async () => {
    mockOrigin.mockReturnValue(false)
    const result = await callAction(action, {
      formData: { intent: "revokeCert", serialNumber: "AB" },
      headers: { Origin: "http://evil" },
    })
    expect(expectData<Response>(result).status).toBe(403)
    expect(mockParse).not.toHaveBeenCalled()
  })

  it("short-circuits with the parser's error shape", async () => {
    mockParse.mockReturnValue({ error: "Missing serial number" } as never)
    const result = await callAction(action, { formData: { intent: "renewCert" } })
    const data = expectData<{ error?: string }>(result)
    expect(data).toEqual({ error: "Missing serial number" })
    expect(mockHandle).not.toHaveBeenCalled()
  })

  it("returns the mutation result on success", async () => {
    mockParse.mockReturnValue({ intent: "renewCert", serialNumber: "AB", auth: {} } as never)
    // The action pipes the handler through Effect.orDie, so the mock must
    // return a real (pipeable) Effect; the mocked runEffect yields the result.
    mockHandle.mockReturnValue(Effect.void as never)
    mockRunEffect.mockResolvedValue({ certSent: true } as never)
    const result = await callAction(action, { formData: { intent: "renewCert", serialNumber: "AB" } })
    const data = expectData<{ certSent?: boolean }>(result)
    expect(data).toEqual({ certSent: true })
  })
})

// ===========================================================================
// Component-render test — a certificate's device label renders in the list
// ===========================================================================

import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import DevicesPage from "./devices"
import { renderRoute } from "~/test/render-route"

const pageData = (extra: Record<string, unknown>) => () => ({
  email: "a@example.com",
  budget: { used: 0, limit: 3, nextAvailable: null },
  certificates: [],
  pendingClaim: null,
  ...extra,
})

/** The warning Alert (greenrack renders every Alert as role="alert"), by its text. */
const findWarning = async (text: RegExp) => {
  await screen.findByText(text)
  const warning = screen.getAllByRole("alert").find((alert) => text.test(alert.textContent ?? ""))
  if (!warning) throw new Error(`no alert matching ${text}`)
  return warning
}

describe("DevicesPage: the presented certificate is revoked", () => {
  const revoked = { revokedAt: "2026-09-23T16:22:23.000Z", label: null }

  it("warns, with the revoke date and its own Add a device button", async () => {
    renderRoute({
      route: { path: "/devices", Component: DevicesPage as never, loader: pageData({ presentedRevoked: revoked }) },
      url: "/devices",
    })
    const warning = await findWarning(/The certificate this device presented was revoked on/)
    expect(warning).not.toBeNull()
    expect(within(warning).getByRole("button", { name: "Add a device" })).toBeEnabled()
    // The header keeps its own: same name, two buttons page-wide.
    expect(screen.getAllByRole("button", { name: "Add a device" })).toHaveLength(2)
  })

  it("disables its button while the device setup is being issued", async () => {
    renderRoute({
      route: {
        path: "/devices",
        Component: DevicesPage as never,
        loader: pageData({ presentedRevoked: revoked }),
        action: () => new Promise(() => {}), // the issue never answers: stays submitting
      },
      url: "/devices",
    })
    const warning = await findWarning(/The certificate this device presented was revoked on/)
    await userEvent.click(within(warning).getByRole("button", { name: "Add a device" }))
    await waitFor(() => {
      expect(within(warning).getByRole("button", { name: "Add a device" })).toBeDisabled()
    })
  })

  it("points to the waiting setup, with no button, when one is pending", async () => {
    renderRoute({
      route: {
        path: "/devices",
        Component: DevicesPage as never,
        loader: pageData({
          presentedRevoked: revoked,
          pendingClaim: { expiresAt: new Date(Date.now() + 3600_000).toISOString() },
        }),
      },
      url: "/devices",
    })
    const warning = await findWarning(/use “Show the link again” in the device setup below/)
    expect(within(warning).queryByRole("button")).toBeNull()
  })

  it("shows no warning when the presented certificate is not revoked", async () => {
    renderRoute({
      route: {
        path: "/devices",
        Component: DevicesPage as never,
        loader: pageData({
          presentedRevoked: null,
          pendingClaim: { expiresAt: new Date(Date.now() + 3600_000).toISOString() },
        }),
      },
      url: "/devices",
    })
    await screen.findByText(/A device setup is waiting/)
    expect(screen.queryByText(/The certificate this device presented/)).toBeNull()
  })
})

describe("DevicesPage component", () => {
  it("renders a certificate's device label", async () => {
    renderRoute({
      route: {
        path: "/devices",
        Component: DevicesPage as never,
        loader: () => ({
          email: "a@example.com",
          budget: { used: 0, limit: 3, nextAvailable: null },
          certificates: [
            {
              id: "c1",
              inviteId: null,
              userId: null,
              username: "alice",
              email: "a@example.com",
              label: "MacBook Pro",
              serialNumber: "ABCDEF0123456789",
              issuedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
              revokedAt: null,
              revokeState: null,
              revokeError: null,
              renewedFromSerial: null,
            },
          ],
        }),
      },
      url: "/devices",
    })
    await waitFor(() => {
      expect(screen.getByText("MacBook Pro")).toBeInTheDocument()
    })
  })
})
