import { describe, expect, it, vi, beforeEach, beforeAll, afterAll, afterEach } from "vitest"
import { Effect } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"

// === Test-runtime swap ===
// One line replaces what used to be a wall of vi.mock(...) for every repo
// the loader touches. Route logic now runs real Effect against a real
// (in-memory) PGlite DB — tests seed real rows, assert real outputs.
vi.mock("~/lib/runtime.server", async () => {
  const mod = await import("~/test/test-runtime")
  return { runEffect: mod.testRunEffect }
})

// === Boundary mocks (kept) ===
// auth.server reads cookies/JWT — that's a real boundary tests can't avoid.
vi.mock("~/lib/auth.server", () => ({
  getAuth: vi.fn(),
}))
// authMode is a module-level config constant; the test layer doesn't care
// about it, but the loader's "legacy → skip" short-circuit does.
vi.mock("~/lib/governance-mode.server", () => ({
  authMode: "strict",
}))
// loadApps reads /data/apps.json — file IO outside the Effect runtime.
vi.mock("~/lib/apps.server", () => ({
  loadApps: vi.fn().mockReturnValue([]),
}))

import { getAuth } from "~/lib/auth.server"
import { loadApps } from "~/lib/apps.server"
import { loader } from "./catalog"
import { seedTestDb, truncateAll } from "~/test/test-runtime"
import { callLoader, expectData } from "~/test/route-utils"

const mockGetAuth = vi.mocked(getAuth)
const mockLoadApps = vi.mocked(loadApps)

beforeEach(async () => {
  vi.clearAllMocks()
  mockLoadApps.mockReturnValue([])
  await truncateAll()
})

/** Seed: principal "alice" → app "jellyfin" with one role + open access. */
const seedAliceCatalog = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
             VALUES ('p-alice', 'user', 'alice-sub', 'Alice', 'alice@x')`
  yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, owner_id)
             VALUES ('app-jelly', 'jellyfin', 'Jellyfin', 'open', 'p-alice')`
  yield* sql`INSERT INTO roles (id, application_id, slug, display_name)
             VALUES ('role-viewer', 'app-jelly', 'viewer', 'Viewer')`
})

describe("/catalog loader — iconBySlug map", () => {
  it("builds an iconBySlug map from the static apps registry", async () => {
    mockGetAuth.mockResolvedValue({ user: "alice", sub: "alice-sub", groups: [] } as never)
    mockLoadApps.mockReturnValue([
      { id: "jellyfin", name: "Jellyfin", url: "x", category: "media", icon: "<svg-jf/>", groups: [], priority: 1 },
      { id: "navidrome", name: "Navidrome", url: "x", category: "media", icon: "<svg-nd/>", groups: [], priority: 1 },
      // Apps without an icon shouldn't pollute the map.
      { id: "noicon", name: "NoIcon", url: "x", category: "tools", icon: "", groups: [], priority: 1 },
    ] as never)

    const result = await callLoader(loader, { url: "http://localhost/catalog" })
    const data = expectData<{ iconBySlug: Record<string, string> }>(result)

    expect(data.iconBySlug).toEqual({
      jellyfin: "<svg-jf/>",
      navidrome: "<svg-nd/>",
    })
  })

  it("returns an empty iconBySlug when loadApps throws", async () => {
    mockGetAuth.mockResolvedValue({ user: null, sub: null, groups: [] } as never)
    mockLoadApps.mockImplementation(() => {
      throw new Error("apps.json missing")
    })

    const result = await callLoader(loader, { url: "http://localhost/catalog" })
    const data = expectData<{ iconBySlug: Record<string, string> }>(result)
    expect(data.iconBySlug).toEqual({})
  })
})

describe("/catalog loader — appsCatalogPromise (real DB)", () => {
  it("resolves to [] when no authenticated principal", async () => {
    mockGetAuth.mockResolvedValue({ user: null, sub: null, groups: [] } as never)

    const result = await callLoader(loader, { url: "http://localhost/catalog" })
    const data = expectData<{ appsCatalogPromise: Promise<unknown[]> }>(result)
    const catalog = await data.appsCatalogPromise

    expect(catalog).toEqual([])
  })

  it("resolves to [] when authenticated but the principal isn't in the DB", async () => {
    mockGetAuth.mockResolvedValue({ user: "ghost", sub: "ghost-sub", groups: [] } as never)

    const result = await callLoader(loader, { url: "http://localhost/catalog" })
    const data = expectData<{ appsCatalogPromise: Promise<unknown[]> }>(result)
    const catalog = await data.appsCatalogPromise
    expect(catalog).toEqual([])
  })

  it("resolves to the real catalog when authenticated and the DB has apps", async () => {
    mockGetAuth.mockResolvedValue({ user: "alice", sub: "alice-sub", groups: [] } as never)
    await seedTestDb(seedAliceCatalog)

    const result = await callLoader(loader, { url: "http://localhost/catalog" })
    const data = expectData<{
      appsCatalogPromise: Promise<Array<{ app: { slug: string }; state: string }>>
    }>(result)
    const catalog = await data.appsCatalogPromise

    expect(catalog).toHaveLength(1)
    expect(catalog[0].app.slug).toBe("jellyfin")
    // App has accessMode='open' and no grants → catalog state should be 'open'.
    expect(catalog[0].state).toBe("open")
  })
})

// ===========================================================================
// Component-render tests — real createMemoryRouter, no react-router mocks.
// ===========================================================================

import { render, screen, waitFor } from "@testing-library/react"
import { createMemoryRouter, Outlet, RouterProvider, useLoaderData } from "react-router"
import { setupServer } from "msw/node"
import type { AppCatalogEntry } from "~/lib/apps-catalog.server"
import CatalogPage from "./catalog"

const httpServer = setupServer()
beforeAll(() => httpServer.listen({ onUnhandledRequest: "error" }))
afterAll(() => httpServer.close())
afterEach(() => httpServer.resetHandlers())

const entry = (
  overrides: Partial<{ slug: string; displayName: string; state: string; description: string | null }>,
): AppCatalogEntry =>
  ({
    app: {
      id: `app-${overrides.slug ?? "x"}`,
      slug: overrides.slug ?? "x",
      displayName: overrides.displayName ?? overrides.slug ?? "X",
      description: overrides.description ?? null,
      accessMode: "request",
      enabled: true,
      url: null,
      ownerId: "p-admin",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    state: overrides.state ?? "open",
    grantedRoleIds: [],
    pendingTargets: [],
    roles: [],
    requestableRoleIds: [],
  }) as unknown as AppCatalogEntry

const renderCatalog = (
  catalog: AppCatalogEntry[],
  url = "/catalog",
  dashboard: { user: string; isAdmin: boolean } = { user: "alice", isAdmin: false },
) => {
  // Pre-resolve the promise ONCE so router revalidations don't re-trip
  // Suspense in a loop (same pattern as home.test.tsx).
  const appsCatalogPromise = Promise.resolve(catalog)
  const router = createMemoryRouter(
    [
      {
        id: "routes/dashboard",
        path: "/",
        loader: () => dashboard,
        Component: () => <Outlet />,
        children: [
          {
            path: "catalog",
            loader: () => ({ appsCatalogPromise, iconBySlug: {} }),
            Component: () => {
              const data = useLoaderData()
              const props = { loaderData: data } as unknown as Parameters<typeof CatalogPage>[0]
              return <CatalogPage {...props} />
            },
          },
        ],
      },
    ],
    { initialEntries: [url] },
  )
  return render(<RouterProvider router={router} />)
}

describe("CatalogPage component — empty catalog", () => {
  it("renders the catalog-is-empty state (no search bar)", async () => {
    renderCatalog([])
    await waitFor(() => {
      expect(screen.getByText(/No apps are available/i)).toBeInTheDocument()
    })
    // No search bar when the catalog is empty.
    expect(screen.queryByPlaceholderText("Search apps…")).not.toBeInTheDocument()
  })
})

describe("CatalogPage component — populated", () => {
  it("renders the table with one row per catalog entry + the search bar + state chips", async () => {
    renderCatalog([
      entry({ slug: "jellyfin", displayName: "Jellyfin", state: "open" }),
      entry({ slug: "vault", displayName: "Vault", state: "requestable" }),
      entry({ slug: "gitea", displayName: "Gitea", state: "pending" }),
    ])

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search apps…")).toBeInTheDocument()
    })
    expect(screen.getByText("Jellyfin")).toBeInTheDocument()
    expect(screen.getByText("Vault")).toBeInTheDocument()
    expect(screen.getByText("Gitea")).toBeInTheDocument()
    // One chip per state that appears in the catalog. The chips are toggle
    // buttons (aria-pressed), action buttons in each row are not — narrow by
    // attribute to avoid matching the row's "Request access" / "View request"
    // primary actions that share the chip's label.
    const chips = screen.getAllByRole("button", { pressed: false })
    const chipLabels = chips.map((c) => c.textContent ?? "")
    expect(chipLabels.some((l) => l.includes("Open"))).toBe(true)
    expect(chipLabels.some((l) => l.includes("Request access"))).toBe(true)
    expect(chipLabels.some((l) => l.includes("Pending"))).toBe(true)
  })

  it("surfaces the pending-requests banner when at least one row is pending", async () => {
    renderCatalog([
      entry({ slug: "jellyfin", state: "open" }),
      entry({ slug: "vault", state: "pending" }),
      entry({ slug: "gitea", state: "pending" }),
    ])

    await waitFor(() => {
      // Banner copy comes from the apps.pendingBanner_one/_other plural key.
      expect(screen.getByText(/You have 2 pending request/i)).toBeInTheDocument()
    })
  })

  it("hides the pending banner when no row is in 'pending'", async () => {
    renderCatalog([entry({ slug: "jellyfin", state: "open" })])

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search apps…")).toBeInTheDocument()
    })
    expect(screen.queryByText(/pending request/i)).not.toBeInTheDocument()
  })

  it("filters to one row when ?q= matches one displayName", async () => {
    renderCatalog(
      [
        entry({ slug: "jellyfin", displayName: "Jellyfin", state: "open" }),
        entry({ slug: "vault", displayName: "Vault", state: "open" }),
      ],
      "/catalog?q=jelly",
    )

    await waitFor(() => {
      expect(screen.getByText("Jellyfin")).toBeInTheDocument()
    })
    expect(screen.queryByText("Vault")).not.toBeInTheDocument()
  })

  it("hydrates the selected state chip from ?state= and filters the table", async () => {
    renderCatalog(
      [
        entry({ slug: "jellyfin", displayName: "Jellyfin", state: "open" }),
        entry({ slug: "vault", displayName: "Vault", state: "requestable" }),
      ],
      "/catalog?state=open",
    )

    await waitFor(() => {
      // Find the chip via aria-pressed — that disambiguates from any in-row
      // "Open" launch button that doesn't carry pressed state.
      const openChip = screen.getByRole("button", { name: "Open", pressed: true })
      expect(openChip).toBeInTheDocument()
    })
    expect(screen.getByText("Jellyfin")).toBeInTheDocument()
    expect(screen.queryByText("Vault")).not.toBeInTheDocument()
  })

  it("shows the no-results EmptyState when ?q= matches nothing", async () => {
    renderCatalog(
      [entry({ slug: "jellyfin", displayName: "Jellyfin", state: "open" })],
      "/catalog?q=nothingmatchesthis",
    )

    await waitFor(() => {
      expect(screen.getByText(/No matching apps/i)).toBeInTheDocument()
    })
  })
})
