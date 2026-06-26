import { describe, it, expect } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import AdminRecoveryPage from "./admin.recovery"
import { renderRoute } from "~/test/render-route"
import { t } from "~/test/test-utils"
import type { RecoveryRequest } from "~/lib/services/RecoveryRepo.server"

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
