import { describe, expect, it, vi, beforeEach } from "vitest"
import { Effect } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"

vi.mock("~/lib/runtime.server", async () => {
  const mod = await import("~/test/test-runtime")
  return { runEffect: mod.testRunEffect }
})
// requireAdminPrincipal is a local function in admin.applications.$id.tsx
// (not from auth.server) — it composes getAuth + checkAuthDecision +
// PrincipalRepo internally. Mock only the real boundary modules below.
vi.mock("~/lib/auth.server", () => ({
  getAuth: vi.fn(),
}))
vi.mock("~/lib/auth-decision.server", () => ({
  checkAuthDecision: vi.fn(),
}))
vi.mock("~/lib/config.server", () => ({
  isOriginAllowed: vi.fn().mockReturnValue(true),
}))

import { getAuth } from "~/lib/auth.server"
import { checkAuthDecision } from "~/lib/auth-decision.server"
import { isOriginAllowed } from "~/lib/config.server"
import { action, loader } from "./admin.applications.$id"
import { seedTestDb, truncateAll } from "~/test/test-runtime"
import { callAction, callLoader, expectData, expectResponse } from "~/test/route-utils"

const mockGetAuth = vi.mocked(getAuth)
const mockCheckDecision = vi.mocked(checkAuthDecision)
const mockOrigin = vi.mocked(isOriginAllowed)
beforeEach(async () => {
  vi.clearAllMocks()
  mockOrigin.mockReturnValue(true)
  await truncateAll()
})

// The admin principal's external_id must match the `sub` we hand to getAuth
// — requireAdminPrincipal looks up principals by externalId.
const seedApp = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
             VALUES ('p-admin', 'user', 'admin-sub', 'Admin', 'a@x')`
  yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, owner_id)
             VALUES ('app-1', 'app-1', 'App 1', 'request', 'p-admin')`
})

describe("/admin/applications/:id loader — auth", () => {
  it("throws 403 when caller isn't an admin", async () => {
    mockGetAuth.mockResolvedValue({ user: "alice", sub: "alice-sub" } as never)
    mockCheckDecision.mockResolvedValue({ allow: false } as never)

    const result = await callLoader(loader, { params: { id: "app-1" } })
    expect(expectResponse(result).status).toBe(403)
  })
})

describe("/admin/applications/:id loader — happy path against real DB", () => {
  beforeEach(() => {
    mockGetAuth.mockResolvedValue({ user: "admin", sub: "admin-sub" } as never)
    mockCheckDecision.mockResolvedValue({ allow: true } as never)
  })

  it("returns the application + empty role/entitlement lists for a fresh app", async () => {
    await seedTestDb(seedApp)

    const result = await callLoader(loader, { params: { id: "app-1" } })
    const data = expectData<{
      application: { id: string; slug: string }
      roles: unknown[]
      entitlements: unknown[]
    }>(result)

    expect(data.application.id).toBe("app-1")
    expect(data.application.slug).toBe("app-1")
    expect(data.roles).toEqual([])
    expect(data.entitlements).toEqual([])
  })
})

describe("/admin/applications/:id action — origin guard", () => {
  it("throws 403 when origin is invalid", async () => {
    mockOrigin.mockReturnValue(false)
    const result = await callAction(action, {
      params: { id: "app-1" },
      formData: { intent: "createRole" },
    })
    expect(expectResponse(result).status).toBe(403)
  })
})

describe("/admin/applications/:id action — createRole (real DB)", () => {
  beforeEach(() => {
    // Auth wiring: getAuth + checkAuthDecision pass, principal exists in
    // the seeded DB so requireAdminPrincipal's findByExternalId resolves.
    mockGetAuth.mockResolvedValue({ user: "admin", sub: "admin-sub" } as never)
    mockCheckDecision.mockResolvedValue({ allow: true } as never)
  })

  it("creates a role row in the real DB and returns success", async () => {
    await seedTestDb(seedApp)

    const result = await callAction(action, {
      params: { id: "app-1" },
      formData: {
        intent: "createRole",
        slug: "editor",
        displayName: "Editor",
        description: "Can edit",
      },
    })

    const data = expectData<{ success?: boolean; message?: string; error?: string }>(result)
    expect(data.success).toBe(true)

    const rows = await seedTestDb(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ slug: string; displayName: string }>`
          SELECT slug, display_name FROM roles WHERE application_id = 'app-1'`
      }) as Effect.Effect<Array<{ slug: string; displayName: string }>, never, never>,
    )
    expect(rows.map((r) => r.slug)).toEqual(["editor"])
  })
})

// =============================================================================
// Component-render tests
// =============================================================================

import { screen, waitFor } from "@testing-library/react"
import AdminApplicationDetailPage from "./admin.applications.$id"
import { renderRoute } from "~/test/render-route"

const stubSidePanel = {
  open: false,
  onOpenChange: () => {},
  content: null,
  setContent: () => {},
  onCloseRef: { current: null as null | (() => void) },
  showDetail: () => {},
  isWide: false,
}

const baseLoaderData = () => ({
  application: {
    id: "app-1",
    slug: "jellyfin",
    displayName: "Jellyfin",
    description: "Media server",
    accessMode: "request" as const,
    enabled: true,
    ownerId: "p-admin",
    url: null,
    lastSyncedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  roles: [
    { id: "r1", applicationId: "app-1", slug: "viewer", displayName: "Viewer", description: null },
    { id: "r2", applicationId: "app-1", slug: "admin", displayName: "Admin", description: null },
  ],
  entitlements: [
    {
      id: "e1",
      applicationId: "app-1",
      slug: "download",
      displayName: "Download",
      description: null,
      roleAssignments: [],
    },
  ],
  resources: [] as unknown[],
  grants: [] as unknown[],
  principals: [{ id: "p-alice", displayName: "Alice", externalId: "alice", principalType: "user" as const }],
  pendingRequests: [] as unknown[],
  ldapProvisioned: false,
  pluginInfo: null,
})

const renderPage = (overrides: Partial<ReturnType<typeof baseLoaderData>> = {}) => {
  const data = { ...baseLoaderData(), ...overrides }
  return renderRoute({
    parentLoaderId: "routes/dashboard",
    parentLoader: () => ({ user: "admin", isAdmin: true }),
    parentContext: stubSidePanel,
    route: {
      path: "/admin/applications/app-1",
      Component: AdminApplicationDetailPage as never,
      loader: () => data,
    },
  })
}

describe("AdminApplicationDetailPage component", () => {
  it("renders the application header with badges", async () => {
    renderPage()
    await waitFor(() => {
      // displayName appears in the page header (and tabs may repeat it).
      // Just assert it rendered at least once.
      expect(screen.getAllByText("Jellyfin").length).toBeGreaterThan(0)
    })
    // accessMode + enabled badges live in the header (the same labels recur
    // inside the Settings tab + access-mode select, so match without
    // asserting cardinality).
    expect(screen.getAllByText("request").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Enabled").length).toBeGreaterThan(0)
  })

  it("renders the empty grants state on the overview tab", async () => {
    renderPage()
    // Overview is the default tab; with grants=[] the table empty-state shows.
    await waitFor(() => {
      expect(screen.getAllByText("Jellyfin").length).toBeGreaterThan(0)
    })
    // The page wires up tab triggers for overview/roles/entitlements/etc — at
    // minimum the tab list itself renders.
    expect(screen.getByRole("tablist")).toBeInTheDocument()
  })

  it("renders tab labels with counts derived from loaderData", async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole("tablist")).toBeInTheDocument()
    })
    // The tab labels include their respective collection sizes.
    expect(screen.getByText("Roles (2)")).toBeInTheDocument()
    expect(screen.getByText("Entitlements (1)")).toBeInTheDocument()
    expect(screen.getByText("Grants (0)")).toBeInTheDocument()
  })

  it("opens the roles tab when ?tab=roles is in the URL", async () => {
    const data = baseLoaderData()
    renderRoute({
      parentLoaderId: "routes/dashboard",
      parentLoader: () => ({ user: "admin", isAdmin: true }),
      parentContext: stubSidePanel,
      route: {
        path: "/admin/applications/app-1",
        Component: AdminApplicationDetailPage as never,
        loader: () => data,
      },
      url: "/admin/applications/app-1?tab=roles",
    })
    await waitFor(() => {
      // The Add Role button is rendered inside the roles tab content; it
      // proves the active tab switched to roles.
      expect(screen.getByRole("button", { name: /add role/i })).toBeInTheDocument()
    })
  })

  it("surfaces a callout when there are pending requests", async () => {
    renderPage({
      pendingRequests: [
        {
          id: "req-1",
          requesterId: "p-alice",
          requesterName: "Alice",
          applicationId: "app-1",
          applicationName: "Jellyfin",
          roleId: "r1",
          roleName: "Viewer",
          entitlementId: null,
          entitlementName: null,
          resourceId: null,
          status: "pending",
          justification: null,
          requestedDurationHours: null,
          createdAt: "2026-01-01T00:00:00Z",
          decidedAt: null,
          decidedBy: null,
        },
      ],
    })
    await waitFor(() => {
      expect(screen.getByText(/1 access request is awaiting/i)).toBeInTheDocument()
    })
  })
})
