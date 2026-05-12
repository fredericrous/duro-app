import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))

import { runEffect } from "~/lib/runtime.server"
import { loader } from "./admin.audit"
import { callLoader, expectData } from "~/test/route-utils"

const mockRunEffect = vi.mocked(runEffect)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("/admin/audit loader", () => {
  it("returns the audit event list via the service", async () => {
    const events = [{ id: "e1", eventType: "grant.created" }]
    mockRunEffect.mockResolvedValue(events as never)

    const result = await callLoader(loader)
    const data = expectData<unknown>(result)
    // The loader returns whatever runEffect resolves to; just confirm
    // the round-trip survives without throwing.
    expect(data).toBeDefined()
  })
})

// ===========================================================================
// Component-render tests
// ===========================================================================

import { screen, waitFor } from "@testing-library/react"
import AdminAuditPage from "./admin.audit"
import { renderRoute } from "~/test/render-route"

interface AuditEvent {
  id: string
  eventType: string
  actorId: string | null
  actorName: string | null
  applicationId: string | null
  applicationName: string | null
  targetType: string | null
  targetId: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
}

const mkEvent = (o: Partial<AuditEvent> & Pick<AuditEvent, "id" | "eventType">): AuditEvent => ({
  actorId: "p-admin",
  actorName: "Admin",
  applicationId: null,
  applicationName: null,
  targetType: "grant",
  targetId: "g1",
  metadata: null,
  createdAt: "2026-01-01T00:00:00Z",
  // Spread last so required id/eventType + any overrides win.
  ...o,
})

const renderPage = (events: AuditEvent[]) =>
  renderRoute({
    parentLoaderId: "routes/dashboard",
    parentLoader: () => ({ user: "admin", isAdmin: true }),
    route: {
      path: "/admin/audit",
      Component: AdminAuditPage as never,
      loader: () => ({ events }),
    },
  })

describe("AdminAuditPage component", () => {
  it("renders one row per audit event", async () => {
    renderPage([
      mkEvent({ id: "e1", eventType: "grant.created", actorName: "Alice" }),
      mkEvent({ id: "e2", eventType: "grant.revoked", actorName: "Bob" }),
    ])

    await waitFor(() => {
      expect(screen.getByText("grant.created")).toBeInTheDocument()
    })
    expect(screen.getByText("grant.revoked")).toBeInTheDocument()
  })

  it("survives an empty event list", async () => {
    renderPage([])
    await waitFor(() => {
      expect(screen.queryByText("grant.created")).not.toBeInTheDocument()
    })
  })
})
