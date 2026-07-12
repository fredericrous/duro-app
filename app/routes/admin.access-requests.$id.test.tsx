import { describe, expect, it, vi, beforeEach } from "vitest"
import { Effect } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"

vi.mock("~/lib/runtime.server", async () => {
  const mod = await import("~/test/test-runtime")
  return { runEffect: mod.testRunEffect }
})
vi.mock("~/lib/auth.server", () => ({
  getAuth: vi.fn(),
}))
vi.mock("~/lib/config.server", () => ({
  isOriginAllowed: vi.fn().mockReturnValue(true),
}))

import { getAuth } from "~/lib/auth.server"
import { isOriginAllowed } from "~/lib/config.server"
import { action, loader } from "./admin.access-requests.$id"
import { seedTestDb, truncateAll } from "~/test/test-runtime"
import { callAction, callLoader, expectData, expectResponse } from "~/test/route-utils"

const mockGetAuth = vi.mocked(getAuth)
const mockOrigin = vi.mocked(isOriginAllowed)

beforeEach(async () => {
  vi.clearAllMocks()
  mockOrigin.mockReturnValue(true)
  await truncateAll()
})

const seedRequest = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
             VALUES ('p-alice', 'user', 'alice-sub', 'Alice', 'a@x'),
                    ('p-admin', 'user', 'admin-sub', 'Admin', 'ad@x')`
  yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, owner_id)
             VALUES ('app-1', 'app-1', 'App 1', 'request', 'p-admin')`
  yield* sql`INSERT INTO roles (id, application_id, slug, display_name)
             VALUES ('role-1', 'app-1', 'editor', 'Editor')`
  yield* sql`INSERT INTO access_requests (id, requester_id, application_id, role_id, status, justification)
             VALUES ('req-1', 'p-alice', 'app-1', 'role-1', 'pending', 'please')`
})

describe("/admin/access-requests/:id loader", () => {
  it("returns the enriched request + its approvals (real DB)", async () => {
    await seedTestDb(seedRequest)

    const result = await callLoader(loader, { params: { id: "req-1" } })
    const data = expectData<{
      accessRequest: { id: string; status: string; applicationName: string; roleName: string | null }
      approvals: unknown[]
    }>(result)

    expect(data.accessRequest.id).toBe("req-1")
    expect(data.accessRequest.status).toBe("pending")
    expect(data.accessRequest.applicationName).toBe("App 1")
    expect(data.accessRequest.roleName).toBe("Editor")
    // No approval rows seeded → empty array
    expect(data.approvals).toEqual([])
  })

  it("throws a 404 Response when the id doesn't match anything", async () => {
    const result = await callLoader(loader, { params: { id: "nope" } })
    expect(expectResponse(result).status).toBe(404)
  })
})

describe("/admin/access-requests/:id action — origin gate", () => {
  it("throws 403 when origin is invalid", async () => {
    mockOrigin.mockReturnValue(false)
    const result = await callAction(action, {
      params: { id: "req-1" },
      formData: { intent: "approve" },
    })
    expect(expectResponse(result).status).toBe(403)
  })

  it("returns the not_authenticated error when the session has no sub", async () => {
    mockGetAuth.mockResolvedValueOnce({ user: "alice", sub: undefined } as never)
    const result = await callAction(action, {
      params: { id: "req-1" },
      formData: { intent: "approve" },
    })
    const data = expectData<{ error?: string }>(result)
    expect(data.error).toBe("not_authenticated")
  })

  it("returns principal_not_found when the auth sub doesn't match any principal", async () => {
    mockGetAuth.mockResolvedValueOnce({ user: "ghost", sub: "ghost-sub" } as never)
    // No principals seeded → findByExternalId returns null.
    const result = await callAction(action, {
      params: { id: "req-1" },
      formData: { intent: "approve" },
    })
    const data = expectData<{ error?: string }>(result)
    expect(data.error).toBe("principal_not_found")
  })

  it("returns the unknown-intent error for an unrecognized intent", async () => {
    // Seed an admin principal so the auth lookup succeeds.
    await seedTestDb(seedRequest)
    mockGetAuth.mockResolvedValueOnce({ user: "admin", sub: "admin-sub" } as never)
    const result = await callAction(action, {
      params: { id: "req-1" },
      formData: { intent: "doesNotExist" },
    })
    const data = expectData<{ error?: string }>(result)
    expect(data.error).toBe("Unknown intent")
  })
})

// =============================================================================
// Component-render tests
// =============================================================================

import { screen, waitFor, fireEvent } from "@testing-library/react"
import AdminAccessRequestDetailPage from "./admin.access-requests.$id"
import { renderRoute } from "~/test/render-route"

type RequestStatus = "pending" | "approved" | "rejected" | "cancelled"

interface AccessRequestFixture {
  id: string
  requesterId: string
  requesterName: string
  applicationId: string
  applicationName: string
  roleId: string | null
  roleName: string | null
  entitlementId: string | null
  entitlementName: string | null
  resourceId: string | null
  status: RequestStatus
  justification: string | null
  requestedDurationHours: number | null
  createdAt: string
  decidedAt: string | null
  decidedBy: string | null
}

const baseAccessRequest = (): AccessRequestFixture => ({
  id: "req-1",
  requesterId: "p-alice",
  requesterName: "Alice",
  applicationId: "app-1",
  applicationName: "Jellyfin",
  roleId: "role-1",
  roleName: "Editor",
  entitlementId: null,
  entitlementName: null,
  resourceId: null,
  status: "pending",
  justification: "I need media access",
  requestedDurationHours: 24,
  createdAt: "2026-01-01T00:00:00Z",
  decidedAt: null,
  decidedBy: null,
})

const renderPage = (overrides: { request?: AccessRequestFixture; approvals?: unknown[] } = {}) => {
  const accessRequest = overrides.request ?? baseAccessRequest()
  const approvals = overrides.approvals ?? []
  return renderRoute({
    parentLoaderId: "routes/dashboard",
    parentLoader: () => ({ user: "admin", isAdmin: true }),
    route: {
      path: "/admin/access-requests/req-1",
      Component: AdminAccessRequestDetailPage as never,
      loader: () => ({ accessRequest, approvals }),
    },
  })
}

describe("AdminAccessRequestDetailPage component", () => {
  it("renders the request fields + decision form when pending", async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument()
    })
    expect(screen.getByText("Jellyfin")).toBeInTheDocument()
    expect(screen.getByText("Editor")).toBeInTheDocument()
    expect(screen.getByText("I need media access")).toBeInTheDocument()
    expect(screen.getByText("24 hours")).toBeInTheDocument()
    // Decision controls visible only when status === "pending".
    expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /reject/i })).toBeInTheDocument()
  })

  it("confirms before rejecting the request", async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: /reject/i }))
    await waitFor(() => expect(screen.getByText("Reject this access request?")).toBeInTheDocument())
  })

  it("hides the decision form when the request is no longer pending", async () => {
    renderPage({ request: { ...baseAccessRequest(), status: "approved" } })
    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument()
    })
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument()
  })

  it("renders the approvals list when approvals are present", async () => {
    renderPage({
      approvals: [
        {
          id: "ap-1",
          requestId: "req-1",
          approverId: "p-admin",
          decision: "approved" as const,
          comment: "looks good",
          decidedAt: "2026-01-02T00:00:00Z",
        },
      ],
    })
    await waitFor(() => {
      expect(screen.getByText("looks good")).toBeInTheDocument()
    })
    expect(screen.getByText(/Approvals \(1\)/)).toBeInTheDocument()
  })
})
