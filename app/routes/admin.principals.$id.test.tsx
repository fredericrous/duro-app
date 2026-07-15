import { describe, expect, it, vi, beforeEach } from "vitest"
import { Effect } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"

vi.mock("~/lib/runtime.server", async () => {
  const mod = await import("~/test/test-runtime")
  return { runEffect: mod.testRunEffect }
})
vi.mock("~/lib/admin-guard.server", () => ({
  requireAdmin: vi
    .fn()
    .mockResolvedValue({ sub: "admin", user: "admin", email: "admin@test", groups: ["lldap_admin"] }),
  requireAdminAction: vi
    .fn()
    .mockResolvedValue({ sub: "admin", user: "admin", email: "admin@test", groups: ["lldap_admin"] }),
}))

import { requireAdmin } from "~/lib/admin-guard.server"
import { loader } from "./admin.principals.$id"
import { seedTestDb, truncateAll } from "~/test/test-runtime"
import { callLoader, expectData } from "~/test/route-utils"

beforeEach(async () => {
  vi.clearAllMocks()
  await truncateAll()
})

const seedPrincipal = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
             VALUES ('p-alice', 'user', 'alice-sub', 'Alice', 'alice@x')`
  yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, owner_id)
             VALUES ('app-1', 'app-1', 'App 1', 'request', 'p-alice')`
  yield* sql`INSERT INTO roles (id, application_id, slug, display_name)
             VALUES ('role-1', 'app-1', 'editor', 'Editor')`
  yield* sql`INSERT INTO grants (id, principal_id, role_id, granted_by)
             VALUES ('g-1', 'p-alice', 'role-1', 'p-alice')`
})

describe("/admin/principals/:id loader", () => {
  it("returns the principal + their grants from the real DB", async () => {
    await seedTestDb(seedPrincipal)

    const result = await callLoader(loader, { params: { id: "p-alice" } })
    const data = expectData<{ principal: { id: string; displayName: string }; grants: unknown[] }>(result)

    expect(data.principal.id).toBe("p-alice")
    expect(data.principal.displayName).toBe("Alice")
    expect(data.grants).toHaveLength(1)
  })

  it("throws a 404 Response when the id doesn't match", async () => {
    const result = await callLoader(loader, { params: { id: "ghost" } })
    expect(result.kind).toBe("response")
    if (result.kind === "response") expect(result.response.status).toBe(404)
  })

  it("denies a non-admin caller (403) when the guard rejects", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new Response("Forbidden", { status: 403 }))
    const result = await callLoader(loader, { params: { id: "p-alice" } })
    expect(result.kind).toBe("response")
    if (result.kind === "response") expect(result.response.status).toBe(403)
  })
})

// =============================================================================
// Component-render tests
// =============================================================================

import { screen, waitFor } from "@testing-library/react"
import AdminPrincipalDetailPage from "./admin.principals.$id"
import { renderRoute } from "~/test/render-route"

const renderPage = (data: { principal?: unknown; grants?: unknown[]; groups?: unknown[] } = {}) =>
  renderRoute({
    parentLoaderId: "routes/dashboard",
    parentLoader: () => ({ user: "admin", isAdmin: true }),
    route: {
      path: "/admin/principals/p-alice",
      Component: AdminPrincipalDetailPage as never,
      loader: () => ({
        principal: data.principal ?? {
          id: "p-alice",
          principalType: "user",
          externalId: "alice-sub",
          displayName: "Alice",
          email: "alice@example.com",
          enabled: true,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
        grants: data.grants ?? [],
        groups: data.groups ?? [],
      }),
    },
  })

describe("AdminPrincipalDetailPage component", () => {
  it("renders header info + empty grants/groups state", async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument()
    })
    // Email is concatenated with " · " separators inside the header Text node,
    // so just assert at least one node has the text in its textContent.
    const matches = screen.getAllByText((_, node) => Boolean(node?.textContent?.includes("alice@example.com")))
    expect(matches.length).toBeGreaterThan(0)
    expect(screen.getByText("No active grants.")).toBeInTheDocument()
    expect(screen.getByText("Not a member of any groups.")).toBeInTheDocument()
  })

  it("renders grant + group rows when present", async () => {
    renderPage({
      grants: [
        {
          id: "g-12345678",
          principalId: "p-alice",
          roleId: "role-editor",
          entitlementId: null,
          resourceId: null,
          grantedBy: "p-admin",
          expiresAt: null,
          createdAt: "2026-01-01T00:00:00Z",
          revokedAt: null,
          revokedBy: null,
          reason: null,
        },
      ],
      groups: [
        {
          id: "grp-1",
          principalType: "group" as const,
          externalId: "media-team",
          displayName: "Media Team",
          email: null,
          enabled: true,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
    })

    await waitFor(() => {
      expect(screen.getByText("role-editor")).toBeInTheDocument()
    })
    expect(screen.getByText("Media Team")).toBeInTheDocument()
    expect(screen.getByText(/Active Grants \(1\)/)).toBeInTheDocument()
    expect(screen.getByText(/Groups \(1\)/)).toBeInTheDocument()
  })
})
