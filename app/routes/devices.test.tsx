import { describe, expect, it, vi, beforeEach } from "vitest"
import { Effect } from "effect"

vi.mock("~/lib/auth.server", () => ({
  requireAuth: vi.fn(),
}))
vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))
vi.mock("~/lib/mutations/settings", async (importOriginal) => {
  const mod = await importOriginal<typeof import("~/lib/mutations/settings")>()
  return { ...mod, parseSettingsMutation: vi.fn(), handleSettingsMutation: vi.fn() }
})
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
import { action, loader } from "./devices"
import { callAction, callLoader, expectData } from "~/test/route-utils"
import { t } from "~/test/test-utils"

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
})

describe("/devices action: links by email only for a revoked or unknown device", () => {
  const asked = async (status: unknown, delivery: "link" | "email" = "link") => {
    mockParse.mockReturnValue({ intent: "issueCert", delivery, auth: {} } as never)
    mockHandle.mockReturnValue(Effect.void as never)
    mockRunEffect.mockResolvedValueOnce(status as never).mockResolvedValueOnce({ certSent: true } as never)
    await callAction(action, { formData: { intent: "issueCert", delivery } })
    return mockHandle.mock.calls[0]![0]
  }
  const revokedCert = { serial: "a1b2c3d4e5f", revokedAt: "x", label: null }

  it("a proven revoked certificate: email, whatever the form asked", async () => {
    expect(await asked({ _tag: "Revoked", cert: revokedCert })).toMatchObject({ delivery: "email" })
  })

  it("a revoked row whose CA check did not answer: email (the safe side)", async () => {
    expect(await asked({ _tag: "Unproven" })).toMatchObject({ delivery: "email" })
  })

  it("a lookup that could not tell: email too (a security rule fails closed)", async () => {
    expect(await asked({ _tag: "Unavailable" })).toMatchObject({ delivery: "email" })
  })

  it("a certificate that is not revoked keeps the asked delivery", async () => {
    expect(await asked({ _tag: "NotRevoked" })).toMatchObject({ delivery: "link" })
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
  await screen.findAllByText(text)
  const warning = screen.getAllByRole("alert").find((alert) => text.test(alert.textContent ?? ""))
  if (!warning) throw new Error(`no alert matching ${text}`)
  return warning
}

describe("DevicesPage: the server emailed though the page did not ask (status it could not settle)", () => {
  it("shows the emailed text in a status region, and no QR layout", async () => {
    renderRoute({
      route: {
        path: "/devices",
        Component: DevicesPage as never,
        // Not restricted as far as the loader knows: no warning, header button asks for a link.
        loader: pageData({ presentedRevoked: null }),
        action: async () => ({ certSent: true }),
      },
      url: "/devices",
    })
    await userEvent.click(await screen.findByRole("button", { name: t("devices.newCert") }))
    await screen.findByText(t("devices.qr.emailedTitle"))
    const region = within(screen.getByRole("dialog"))
      .getAllByRole("status")
      .find((r) => r.textContent?.includes(t("devices.qr.emailedBody")))
    expect(region).toBeDefined()
    expect(screen.queryByRole("button", { name: new RegExp(t("devices.qr.copyLink")) })).toBeNull()
  })
})

describe("DevicesPage: the presented certificate is revoked", () => {
  const revoked = { revokedAt: "2026-09-23T16:22:23.000Z", label: null }

  it("warns, with the revoke date and its own Add a device button", async () => {
    renderRoute({
      route: { path: "/devices", Component: DevicesPage as never, loader: pageData({ presentedRevoked: revoked }) },
      url: "/devices",
    })
    const warning = await findWarning(/The certificate this device presented was revoked on/)
    expect(warning).not.toBeNull()
    expect(within(warning).getByRole("button", { name: t("devices.presentedRevoked.action") })).toBeEnabled()
    // The header keeps its own: same name, two buttons page-wide.
    expect(screen.getAllByRole("button", { name: t("devices.presentedRevoked.action") })).toHaveLength(2)
    // Confined to Devices (requireAuth): the header drops "My requests".
    expect(screen.queryByRole("link", { name: new RegExp(t("header.myRequests")) })).toBeNull()
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
    await userEvent.click(within(warning).getByRole("button", { name: t("devices.presentedRevoked.action") }))
    await waitFor(() => {
      expect(within(warning).getByRole("button", { name: t("devices.presentedRevoked.action") })).toBeDisabled()
    })
  })

  it("asks for the link by email and says it was emailed", async () => {
    const asked: string[] = []
    renderRoute({
      route: {
        path: "/devices",
        Component: DevicesPage as never,
        loader: pageData({ presentedRevoked: revoked }),
        action: async ({ request }) => {
          asked.push(String((await request.formData()).get("delivery")))
          return { certSent: true }
        },
      },
      url: "/devices",
    })
    const warning = await findWarning(/The certificate this device presented was revoked on/)
    await userEvent.click(within(warning).getByRole("button", { name: t("devices.presentedRevoked.action") }))
    expect(await screen.findByText(t("devices.qr.emailedTitle"))).toBeInTheDocument()
    expect(asked).toEqual(["email"])
    // No QR code and no copyable link while restricted.
    expect(screen.queryByRole("button", { name: new RegExp(t("devices.qr.copyLink")) })).toBeNull()
  })

  it("shows a sending state, with no QR and no copy button, while the email goes", async () => {
    renderRoute({
      route: {
        path: "/devices",
        Component: DevicesPage as never,
        loader: pageData({ presentedRevoked: revoked }),
        action: () => new Promise(() => {}), // never answers: stays in flight
      },
      url: "/devices",
    })
    const warning = await findWarning(/The certificate this device presented was revoked on/)
    await userEvent.click(within(warning).getByRole("button", { name: t("devices.presentedRevoked.action") }))
    expect(await screen.findByText(t("devices.qr.sendingTitle"))).toBeInTheDocument()
    expect(screen.queryByText(t("devices.qr.title"))).toBeNull()
    expect(screen.queryByRole("button", { name: new RegExp(t("devices.qr.copyLink")) })).toBeNull()
    // The sending line sits in a polite live region, which the emailed text then replaces in place.
    const sendingRegion = within(screen.getByRole("dialog"))
      .getAllByRole("status")
      .find((region) => region.textContent?.includes(t("devices.qr.sending")))
    expect(sendingRegion).toBeDefined()
  })

  it("announces the emailed outcome in the same live region", async () => {
    renderRoute({
      route: {
        path: "/devices",
        Component: DevicesPage as never,
        loader: pageData({ presentedRevoked: revoked }),
        action: async () => ({ certSent: true }),
      },
      url: "/devices",
    })
    const warning = await findWarning(/The certificate this device presented was revoked on/)
    await userEvent.click(within(warning).getByRole("button", { name: t("devices.presentedRevoked.action") }))
    await screen.findByText(t("devices.qr.emailedTitle"))
    expect(within(screen.getByRole("dialog")).getByRole("status")).toHaveTextContent(t("devices.qr.emailedBody"))
  })

  it("offers 'Email the link again' for a waiting setup, guarded while it is in flight", async () => {
    const asked: string[] = []
    renderRoute({
      route: {
        path: "/devices",
        Component: DevicesPage as never,
        loader: pageData({
          presentedRevoked: revoked,
          pendingClaim: { expiresAt: new Date(Date.now() + 3600_000).toISOString() },
        }),
        action: async ({ request }) => {
          const form = await request.formData()
          asked.push(`${form.get("intent")}:${form.get("delivery")}`)
          return new Promise(() => {}) // never answers: stays in flight
        },
      },
      url: "/devices",
    })
    const waiting = await screen.findByText(/A device setup is waiting/)
    const alert = screen.getAllByRole("alert").find((a) => a.contains(waiting)) as HTMLElement
    const button = within(alert).getByRole("button", { name: t("devices.pending.emailAction") })
    await userEvent.click(button)
    await waitFor(() => expect(button).toBeDisabled())
    expect(asked).toEqual(["showClaimLink:email"])
  })

  it("'Try again' after a failed re-send repeats the re-send, never issues a new certificate", async () => {
    const asked: string[] = []
    renderRoute({
      route: {
        path: "/devices",
        Component: DevicesPage as never,
        loader: pageData({
          presentedRevoked: revoked,
          pendingClaim: { expiresAt: new Date(Date.now() + 3600_000).toISOString() },
        }),
        action: async ({ request }) => {
          const form = await request.formData()
          asked.push(`${form.get("intent")}:${form.get("delivery")}`)
          return { certError: "Please wait a minute before sending the link again." }
        },
      },
      url: "/devices",
    })
    const waiting = await screen.findByText(/A device setup is waiting/)
    const alert = screen.getAllByRole("alert").find((a) => a.contains(waiting)) as HTMLElement
    await userEvent.click(within(alert).getByRole("button", { name: t("devices.pending.emailAction") }))
    expect(await screen.findByText(t("devices.qr.sendErrorTitle"))).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: t("devices.qr.retry") }))
    await waitFor(() => expect(asked).toHaveLength(2))
    expect(asked).toEqual(["showClaimLink:email", "showClaimLink:email"])
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
    const warning = await findWarning(new RegExp(t("devices.pending.emailAction")))
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
