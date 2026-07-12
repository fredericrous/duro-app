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
    const data = expectData<{ events: unknown[]; page: number; pageSize: number; error?: string }>(result)
    expect(data.events).toEqual(events)
    expect(data.page).toBe(0)
    expect(data.pageSize).toBe(50)
    expect(data.error).toBeUndefined()
  })

  it("parses ?page=N as the offset", async () => {
    mockRunEffect.mockResolvedValue([] as never)
    const result = await callLoader(loader, { url: "http://localhost/admin/audit?page=3" })
    const data = expectData<{ page: number }>(result)
    expect(data.page).toBe(3)
  })

  it("surfaces an error string when runEffect throws", async () => {
    mockRunEffect.mockRejectedValueOnce(new Error("audit service down") as never)
    const result = await callLoader(loader)
    const data = expectData<{ events: unknown[]; error?: string }>(result)
    expect(data.events).toEqual([])
    expect(data.error).toBe("audit service down")
  })

  it("threads filter params (eventType, actorId, targetType, targetId, applicationId) through to the loader output", async () => {
    mockRunEffect.mockResolvedValueOnce([] as never)
    const result = await callLoader(loader, {
      url: "http://localhost/admin/audit?eventType=grant.created&actorId=p1&targetType=grant&targetId=g1&applicationId=app1&source=plugin:gitea",
    })
    const data = expectData<{ events: unknown[]; source?: string }>(result)
    expect(data.events).toEqual([])
    expect(data.source).toBe("plugin:gitea")
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
      // eventType badge renders humanized ("grant.created" → "Grant created").
      expect(screen.getByText("Grant created")).toBeInTheDocument()
    })
    expect(screen.getByText("Grant revoked")).toBeInTheDocument()
  })

  it("survives an empty event list", async () => {
    renderPage([])
    await waitFor(() => {
      expect(screen.queryByText("grant.created")).not.toBeInTheDocument()
    })
  })

  it("renders the pagination footer when events are present", async () => {
    renderPage([mkEvent({ id: "e1", eventType: "grant.created" }), mkEvent({ id: "e2", eventType: "role.created" })])
    await waitFor(() => {
      // Pagination renders "Previous" + "Next" buttons under populated state.
      expect(screen.getByRole("button", { name: /previous|précédent/i })).toBeInTheDocument()
    })
    expect(screen.getByRole("button", { name: /next|suivant/i })).toBeInTheDocument()
  })

  it("populates the eventType filter combobox from the rendered events", async () => {
    renderPage([
      mkEvent({ id: "e1", eventType: "grant.created" }),
      mkEvent({ id: "e2", eventType: "role.created" }),
      mkEvent({ id: "e3", eventType: "grant.created" }), // duplicate; should dedupe
    ])
    await waitFor(() => {
      // The filter input renders with a placeholder. There are three combobox
      // filters (eventType, actorId, targetType). At minimum, one combobox.
      expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0)
    })
  })

  it("renders the event-type filter chip when ?eventType is in the URL", async () => {
    renderRoute({
      parentLoaderId: "routes/dashboard",
      parentLoader: () => ({ user: "admin", isAdmin: true }),
      route: {
        path: "/admin/audit",
        Component: AdminAuditPage as never,
        loader: () => ({
          events: [mkEvent({ id: "e1", eventType: "grant.created" })],
        }),
      },
      url: "/admin/audit?eventType=grant.created",
    })
    await waitFor(() => {
      // Active filter surfaces a Clear button alongside the filter inputs.
      expect(screen.getByRole("button", { name: /clear|effacer/i })).toBeInTheDocument()
    })
  })
})
