import { describe, expect, it, vi, beforeEach } from "vitest"
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
