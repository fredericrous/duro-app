import { describe, expect, it, vi, beforeEach, beforeAll, afterAll, afterEach } from "vitest"
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
import { action, loader } from "./requests"
import { seedTestDb, truncateAll } from "~/test/test-runtime"
import { callAction, callLoader, expectData } from "~/test/route-utils"

const mockGetAuth = vi.mocked(getAuth)
const mockOrigin = vi.mocked(isOriginAllowed)

beforeEach(async () => {
  vi.clearAllMocks()
  mockOrigin.mockReturnValue(true)
  await truncateAll()
})

/** Seed: alice + an app + a role + one pending request for alice. */
const seedAliceRequest = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
             VALUES ('p-alice', 'user', 'alice-sub', 'Alice', 'a@x')`
  yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, owner_id)
             VALUES ('app-1', 'app-1', 'App 1', 'request', 'p-alice')`
  yield* sql`INSERT INTO roles (id, application_id, slug, display_name)
             VALUES ('role-1', 'app-1', 'editor', 'Editor')`
  yield* sql`INSERT INTO access_requests (id, requester_id, application_id, role_id, status)
             VALUES ('req-1', 'p-alice', 'app-1', 'role-1', 'pending')`
})

describe("/requests loader", () => {
  it("returns [] when not authenticated", async () => {
    mockGetAuth.mockResolvedValue({ user: null, sub: null, groups: [] } as never)

    const result = await callLoader(loader)
    const data = expectData<{ requests: unknown[] }>(result)
    expect(data.requests).toEqual([])
  })

  it("returns the real enriched request rows for the authenticated user", async () => {
    mockGetAuth.mockResolvedValue({ user: "alice", sub: "alice-sub", groups: [] } as never)
    await seedTestDb(seedAliceRequest)

    const result = await callLoader(loader)
    const data = expectData<{
      requests: Array<{ id: string; status: string; applicationName: string; roleName: string | null }>
    }>(result)
    expect(data.requests).toHaveLength(1)
    expect(data.requests[0]).toMatchObject({
      id: "req-1",
      status: "pending",
      applicationName: "App 1",
      roleName: "Editor",
    })
  })
})

describe("/requests action — gates", () => {
  it("403 on bad Origin", async () => {
    mockOrigin.mockReturnValue(false)
    const result = await callAction(action, {
      headers: { Origin: "http://evil" },
      formData: { intent: "cancel", requestId: "r1" },
    })
    expect(expectData<Response>(result).status).toBe(403)
  })

  it("not_authenticated when no user", async () => {
    mockGetAuth.mockResolvedValue({ user: null, sub: null, groups: [] } as never)
    const result = await callAction(action, { formData: { intent: "cancel", requestId: "r1" } })
    expect(expectData<{ error?: string }>(result)).toEqual({ error: "not_authenticated" })
  })

  it("unknown_intent for non-cancel intent", async () => {
    mockGetAuth.mockResolvedValue({ user: "alice", sub: "alice-sub", groups: [] } as never)
    const result = await callAction(action, { formData: { intent: "other" } })
    expect(expectData<{ error?: string }>(result)).toEqual({ error: "unknown_intent" })
  })
})

describe("/requests action — cancel flow", () => {
  beforeEach(() => {
    mockGetAuth.mockResolvedValue({ user: "alice", sub: "alice-sub", groups: [] } as never)
  })

  it("missing_request_id when requestId is blank", async () => {
    const result = await callAction(action, { formData: { intent: "cancel", requestId: "  " } })
    expect(expectData<{ error?: string }>(result)).toEqual({ error: "missing_request_id" })
  })

  it("cancels the user's own pending request and reports success (real DB)", async () => {
    await seedTestDb(seedAliceRequest)

    const result = await callAction(action, { formData: { intent: "cancel", requestId: "req-1" } })
    const data = expectData<{ success?: boolean; message?: string }>(result)
    expect(data).toEqual({ success: true, message: "cancelled" })

    // Verify side-effect: the request's status is now 'cancelled' in the DB.
    const status = await seedTestDb(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ status: string }>`SELECT status FROM access_requests WHERE id = 'req-1'`
        return rows[0]?.status
      }) as Effect.Effect<string | undefined, never, never>,
    )
    expect(status).toBe("cancelled")
  })

  it("not_owned when the request belongs to someone else", async () => {
    // Seed a request owned by a different principal.
    await seedTestDb(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
                   VALUES ('p-alice', 'user', 'alice-sub', 'Alice', 'a@x')`
        yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
                   VALUES ('p-bob', 'user', 'bob-sub', 'Bob', 'b@x')`
        yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, owner_id)
                   VALUES ('app-1', 'a', 'A', 'request', 'p-alice')`
        yield* sql`INSERT INTO roles (id, application_id, slug, display_name)
                   VALUES ('role-1', 'app-1', 'editor', 'Editor')`
        yield* sql`INSERT INTO access_requests (id, requester_id, application_id, role_id, status)
                   VALUES ('req-bob', 'p-bob', 'app-1', 'role-1', 'pending')`
      }) as Effect.Effect<void, never, never>,
    )

    // alice tries to cancel bob's request.
    const result = await callAction(action, { formData: { intent: "cancel", requestId: "req-bob" } })
    expect(expectData<{ error?: string }>(result)).toEqual({ error: "not_owned" })
  })
})

// ===========================================================================
// Component-render tests via createRoutesStub. Central MSW server + global
// setup handle the HTTP boundary; no per-file bootstrap.
// ===========================================================================

import { screen, waitFor } from "@testing-library/react"
import type { AccessRequestEnriched } from "~/lib/governance/AccessRequestRepo.server"
import MyRequestsPage from "./requests"
import { renderRoute } from "~/test/render-route"

const reqRow = (overrides: Partial<AccessRequestEnriched>): AccessRequestEnriched =>
  ({
    id: overrides.id ?? "req-1",
    requesterId: "p-alice",
    applicationId: "app-1",
    roleId: "role-1",
    entitlementId: null,
    resourceId: null,
    justification: null,
    requestedDurationHours: null,
    status: overrides.status ?? "pending",
    resolvedAt: null,
    grantId: null,
    createdAt: "2026-01-01T00:00:00Z",
    expiresAt: null,
    applicationName: overrides.applicationName ?? "App 1",
    applicationSlug: "app-1",
    roleName: overrides.roleName ?? "Editor",
    entitlementName: null,
    ...overrides,
  }) as AccessRequestEnriched

const renderRequests = (
  requests: AccessRequestEnriched[],
  url = "/requests",
  dashboard: { user: string; isAdmin: boolean } = { user: "alice", isAdmin: false },
) =>
  renderRoute({
    parentLoaderId: "routes/dashboard",
    parentLoader: () => dashboard,
    route: {
      path: "/requests",
      Component: MyRequestsPage as never,
      loader: () => ({ requests }),
    },
    url,
  })

describe("MyRequestsPage component", () => {
  it("renders the empty state when the user has no requests", async () => {
    renderRequests([])
    await waitFor(() => {
      // Copy from requests.empty in en/translation.json.
      expect(screen.getByText(/haven't requested access/i)).toBeInTheDocument()
    })
  })

  it("renders the table with one row per request", async () => {
    renderRequests([
      reqRow({ id: "r1", status: "pending", applicationName: "Jellyfin", roleName: "Editor" }),
      reqRow({ id: "r2", status: "approved", applicationName: "Vault", roleName: "Admin" }),
      reqRow({ id: "r3", status: "rejected", applicationName: "Gitea", roleName: "Viewer" }),
    ])

    await waitFor(() => {
      expect(screen.getByText("Jellyfin")).toBeInTheDocument()
    })
    expect(screen.getByText("Vault")).toBeInTheDocument()
    expect(screen.getByText("Gitea")).toBeInTheDocument()
  })

  it("shows the Cancel button only for pending rows", async () => {
    renderRequests([
      reqRow({ id: "r1", status: "pending", applicationName: "App 1" }),
      reqRow({ id: "r2", status: "approved", applicationName: "App 2" }),
    ])

    await waitFor(() => {
      // requests.cancel string from translation.json.
      const cancelButtons = screen.getAllByRole("button", { name: /Cancel/i })
      // Exactly one Cancel button — for the pending row only.
      expect(cancelButtons).toHaveLength(1)
    })
  })

  it("truncates long justification text at 60 characters with an ellipsis", async () => {
    const longText = "x".repeat(120)
    renderRequests([reqRow({ justification: longText })])

    await waitFor(() => {
      // The truncated text is the first 60 chars + "…"
      const truncated = "x".repeat(60) + "…"
      expect(screen.getByText(truncated)).toBeInTheDocument()
    })
  })
})
