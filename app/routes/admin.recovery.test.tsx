import { describe, it, expect, vi, beforeEach } from "vitest"
import { Effect } from "effect"

vi.mock("~/lib/runtime.server", () => ({ runEffect: vi.fn() }))
// The loader self-gates via requireAdmin; the action self-gates via
// requireAdminAction (admin decision + origin). Both allow by default.
vi.mock("~/lib/admin-guard.server", () => ({
  requireAdmin: vi
    .fn()
    .mockResolvedValue({ sub: "admin", user: "admin", email: "admin@test", groups: ["lldap_admin"] }),
  requireAdminAction: vi
    .fn()
    .mockResolvedValue({ sub: "admin", user: "admin", email: "admin@test", groups: ["lldap_admin"] }),
}))
vi.mock("~/lib/workflows/recovery.server", () => ({
  approveRecovery: vi.fn(() => Effect.succeed({ email: "bob@example.com", revokedCount: 2 })),
  denyRecovery: vi.fn(() => Effect.succeed(undefined)),
}))

import { screen, waitFor, fireEvent } from "@testing-library/react"
import AdminRecoveryPage, { loader, action } from "./admin.recovery"
import { runEffect } from "~/lib/runtime.server"
import { requireAdmin, requireAdminAction } from "~/lib/admin-guard.server"
import { approveRecovery, denyRecovery } from "~/lib/workflows/recovery.server"
import { callLoader, callAction, expectData, expectResponse } from "~/test/route-utils"
import { renderRoute } from "~/test/render-route"
import { t } from "~/test/test-utils"
import type { RecoveryRequest } from "~/lib/services/RecoveryRepo.server"

const mockRunEffect = vi.mocked(runEffect)
const mockApprove = vi.mocked(approveRecovery)
const mockDeny = vi.mocked(denyRecovery)

const adminAuth = { sub: "admin", user: "admin", email: "admin@test", groups: ["lldap_admin"] } as never

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAdmin).mockResolvedValue(adminAuth)
  vi.mocked(requireAdminAction).mockResolvedValue(adminAuth)
  mockApprove.mockImplementation(() => Effect.succeed({ email: "bob@example.com", revokedCount: 2 }) as never)
  mockDeny.mockImplementation(() => Effect.succeed(undefined) as never)
})

describe("admin.recovery loader", () => {
  it("returns the pending requests from the repo", async () => {
    mockRunEffect.mockResolvedValue([{ id: "r1" }] as never)
    const data = expectData<{ pending: unknown[] }>(await callLoader(loader))
    expect(data.pending).toEqual([{ id: "r1" }])
  })

  it("denies a non-admin caller (403) when the guard rejects", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new Response("Forbidden", { status: 403 }))
    const result = await callLoader(loader)
    expect(result.kind).toBe("response")
    if (result.kind === "response") expect(result.response.status).toBe(403)
  })
})

describe("admin.recovery action", () => {
  it("403s when the admin/origin gate rejects", async () => {
    vi.mocked(requireAdminAction).mockRejectedValueOnce(new Response("Forbidden", { status: 403 }))
    expect(expectResponse(await callAction(action, { formData: { intent: "deny", requestId: "r1" } })).status).toBe(403)
  })

  it("returns an error when the request id is missing", async () => {
    const data = expectData<{ error?: string }>(await callAction(action, { formData: { intent: "approve" } }))
    expect(data.error).toBe("Missing request id")
  })

  it("approves a request, revoking other devices when checked", async () => {
    mockRunEffect.mockResolvedValue({ email: "bob@example.com", revokedCount: 2 } as never)
    const data = expectData<{ approved?: boolean; email?: string; revokedCount?: number }>(
      await callAction(action, { formData: { intent: "approve", requestId: "r1", revokeOthers: "on" } }),
    )
    expect(data.approved).toBe(true)
    expect(data.email).toBe("bob@example.com")
    expect(data.revokedCount).toBe(2)
    expect(mockApprove).toHaveBeenCalledWith("r1", "admin", true)
  })

  it("denies a request", async () => {
    mockRunEffect.mockResolvedValue(undefined as never)
    const data = expectData<{ denied?: boolean }>(
      await callAction(action, { formData: { intent: "deny", requestId: "r1" } }),
    )
    expect(data.denied).toBe(true)
    expect(mockDeny).toHaveBeenCalledWith("r1", "admin")
  })

  it("rejects an unknown intent", async () => {
    const data = expectData<{ error?: string }>(
      await callAction(action, { formData: { intent: "frobnicate", requestId: "r1" } }),
    )
    expect(data.error).toBe("Unknown action")
  })

  it("surfaces a workflow failure message", async () => {
    mockRunEffect.mockRejectedValue({ cause: { message: "issue failed" } } as never)
    const data = expectData<{ error?: string }>(
      await callAction(action, { formData: { intent: "approve", requestId: "r1" } }),
    )
    expect(data.error).toBe("issue failed")
  })
})

const pendingReq: RecoveryRequest = {
  id: "r1",
  email: "bob@example.com",
  username: "bob",
  note: "lost phone",
  status: "pending",
  requestIp: "1.2.3.4",
  renewalId: null,
  createdAt: new Date().toISOString(),
  reviewedAt: null,
  reviewedBy: null,
}

describe("AdminRecoveryPage", () => {
  it("lists pending requests with approve/deny actions", async () => {
    renderRoute({
      route: {
        path: "/admin/recovery",
        Component: AdminRecoveryPage as never,
        loader: () => ({ pending: [pendingReq] }),
        action: () => ({ approved: true }),
      },
    })

    await waitFor(() => {
      expect(screen.getByText("bob@example.com")).toBeInTheDocument()
    })
    expect(screen.getByText("lost phone")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: t("admin.recovery.approve") })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: t("admin.recovery.deny") })).toBeInTheDocument()
  })

  it("confirms before approving or denying", async () => {
    renderRoute({
      route: {
        path: "/admin/recovery",
        Component: AdminRecoveryPage as never,
        loader: () => ({ pending: [pendingReq] }),
        action: () => ({ approved: true }),
      },
    })
    await waitFor(() => expect(screen.getByText("bob@example.com")).toBeInTheDocument())

    fireEvent.click(screen.getByRole("button", { name: t("admin.recovery.approve") }))
    await waitFor(() => expect(screen.getByText(t("admin.recovery.confirmApproveTitle"))).toBeInTheDocument())
    // The "revoke other devices" opt-in is present and unchecked by default.
    const revokeOthers = screen.getByRole("checkbox", { name: t("admin.recovery.revokeOthers") }) as HTMLInputElement
    expect(revokeOthers.checked).toBe(false)
  })

  it("shows the empty state with no pending requests", async () => {
    renderRoute({
      route: {
        path: "/admin/recovery",
        Component: AdminRecoveryPage as never,
        loader: () => ({ pending: [] }),
        action: () => ({}),
      },
    })

    await waitFor(() => {
      expect(screen.getByText(t("admin.recovery.empty"))).toBeInTheDocument()
    })
  })
})
