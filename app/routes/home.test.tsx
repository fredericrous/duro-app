import { describe, expect, it, vi, beforeEach } from "vitest"
import { Effect } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"

// === Test-runtime swap ===
// Replace runEffect with one bound to a real PGlite + real repos AppLayer.
// Tests seed real rows and assert real outputs — no per-repo mocks.
vi.mock("~/lib/runtime.server", async () => {
  const mod = await import("~/test/test-runtime")
  return { runEffect: mod.testRunEffect }
})

// === Boundary mocks ===
// getAuth reads cookies/JWT — real session boundary, mock here.
vi.mock("~/lib/auth.server", () => ({
  getAuth: vi.fn(),
}))
vi.mock("~/lib/governance-mode.server", () => ({
  authMode: "strict",
}))
vi.mock("~/lib/config.server", () => ({
  config: { categoryOrder: ["media", "tools"] },
  isOriginAllowed: vi.fn().mockReturnValue(true),
}))
vi.mock("~/lib/apps.server", () => ({
  getVisibleApps: vi.fn().mockReturnValue([]),
}))

import { getAuth } from "~/lib/auth.server"
import { isOriginAllowed } from "~/lib/config.server"
import { getVisibleApps } from "~/lib/apps.server"
import { action, loader } from "./home"
import { seedTestDb, truncateAll } from "~/test/test-runtime"
import { callAction, callLoader, expectData } from "~/test/route-utils"

const mockGetAuth = vi.mocked(getAuth)
const mockOrigin = vi.mocked(isOriginAllowed)
const mockGetVisibleApps = vi.mocked(getVisibleApps)

beforeEach(async () => {
  vi.clearAllMocks()
  mockOrigin.mockReturnValue(true)
  mockGetVisibleApps.mockReturnValue([])
  await truncateAll()
})

/** Seed: alice + bob + an app + a role. Approval policy names bob as the
 *  required approver so requests stay 'pending' instead of auto-approving. */
const seedAliceAndApp = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
             VALUES ('p-alice', 'user', 'alice-sub', 'Alice', 'a@x')`
  yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
             VALUES ('p-bob', 'user', 'bob-sub', 'Bob', 'b@x')`
  yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, owner_id)
             VALUES ('app-jelly', 'jellyfin', 'Jellyfin', 'request', 'p-alice')`
  yield* sql`INSERT INTO roles (id, application_id, slug, display_name)
             VALUES ('role-viewer', 'app-jelly', 'viewer', 'Viewer')`
  // Approval policy with one resolvable approver (bob) — the workflow keeps
  // the request 'pending' instead of auto-approving.
  yield* sql`INSERT INTO approval_policies (id, application_id, scope_type, scope_id, mode, rules)
             VALUES ('pol-role', 'app-jelly', 'role', 'role-viewer', 'one_of',
                     '[{"approverType":"principal","approverPrincipalId":"p-bob"}]'::jsonb)`
})

/** Variant that auto-approves: no policy → workflow short-circuits to approved. */
const seedAliceAndAppNoPolicy = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
             VALUES ('p-alice', 'user', 'alice-sub', 'Alice', 'a@x')`
  yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, owner_id)
             VALUES ('app-jelly', 'jellyfin', 'Jellyfin', 'request', 'p-alice')`
  yield* sql`INSERT INTO roles (id, application_id, slug, display_name)
             VALUES ('role-viewer', 'app-jelly', 'viewer', 'Viewer')`
})

describe("/home loader", () => {
  it("returns a homeDataPromise + categoryOrder regardless of auth state", async () => {
    mockGetAuth.mockResolvedValue({ user: null, sub: null, groups: [] } as never)

    const result = await callLoader(loader, { url: "http://localhost/" })
    const data = expectData<{ homeDataPromise: Promise<unknown>; categoryOrder: string[] }>(result)

    expect(data.homeDataPromise).toBeInstanceOf(Promise)
    expect(data.categoryOrder).toEqual(["media", "tools"])
  })

  it("homeDataPromise resolves to staticApps when governance check is skipped", async () => {
    mockGetAuth.mockResolvedValue({ user: null, sub: null, groups: [] } as never)
    const staticApps = [
      { id: "jellyfin", name: "Jellyfin", url: "x", category: "media", icon: "", groups: [], priority: 1 },
    ]
    mockGetVisibleApps.mockReturnValue(staticApps as never)

    const result = await callLoader(loader, { url: "http://localhost/" })
    const data = expectData<{
      homeDataPromise: Promise<{ visibleApps: unknown[]; appsCatalog: unknown[] }>
    }>(result)
    const resolved = await data.homeDataPromise

    expect(resolved.visibleApps).toEqual(staticApps)
    expect(resolved.appsCatalog).toEqual([])
  })
})

describe("/home action — origin guard + validation", () => {
  it("403 Response when Origin is disallowed", async () => {
    mockOrigin.mockReturnValue(false)

    const result = await callAction(action, {
      url: "http://evil.example.com/",
      headers: { Origin: "http://evil.example.com" },
      formData: { intent: "requestAccess" },
    })
    const res = expectData<Response>(result)
    expect(res).toBeInstanceOf(Response)
    expect(res.status).toBe(403)
  })

  it("not_authenticated when getAuth returns no user", async () => {
    mockGetAuth.mockResolvedValue({ user: null, sub: null, groups: [] } as never)
    const result = await callAction(action, { formData: { intent: "requestAccess" } })
    expect(expectData<{ outcome: string; error?: string }>(result)).toEqual({
      outcome: "error",
      error: "not_authenticated",
    })
  })

  it("unknown_intent on unrecognised intent", async () => {
    mockGetAuth.mockResolvedValue({ user: "alice", sub: "alice-sub", groups: [] } as never)
    const result = await callAction(action, { formData: { intent: "else" } })
    expect(expectData<{ outcome: string; error?: string }>(result)).toEqual({
      outcome: "error",
      error: "unknown_intent",
    })
  })

  it("missing_application when applicationId is blank", async () => {
    mockGetAuth.mockResolvedValue({ user: "alice", sub: "alice-sub", groups: [] } as never)
    const result = await callAction(action, {
      formData: { intent: "requestAccess", applicationId: "  ", roleId: "r" },
    })
    expect(expectData<{ outcome: string; error?: string }>(result)).toEqual({
      outcome: "error",
      error: "missing_application",
    })
  })

  it("missing_target when roleId is blank", async () => {
    mockGetAuth.mockResolvedValue({ user: "alice", sub: "alice-sub", groups: [] } as never)
    const result = await callAction(action, {
      formData: { intent: "requestAccess", applicationId: "a", roleId: "" },
    })
    expect(expectData<{ outcome: string; error?: string }>(result)).toEqual({
      outcome: "error",
      error: "missing_target",
    })
  })
})

describe("/home action — requestAccess (real DB)", () => {
  beforeEach(() => {
    mockGetAuth.mockResolvedValue({ user: "alice", sub: "alice-sub", groups: [] } as never)
  })

  it("'submitted' (pending) when an approval policy demands review", async () => {
    await seedTestDb(seedAliceAndApp)

    const result = await callAction(action, {
      formData: {
        intent: "requestAccess",
        applicationId: "app-jelly",
        roleId: "role-viewer",
        justification: "need access",
      },
    })

    const data = expectData<{ outcome: string; requestId?: string; error?: string }>(result)
    expect(data.outcome).toBe("submitted")
    expect(data.requestId).toMatch(/^[0-9a-f-]{36}$/i)

    // Side-effect: the request actually landed in the DB as 'pending'.
    // Note: @effect/sql-pg camelCases column names — `requester_id` is read
    // as `requesterId` on the returned row.
    const row = await seedTestDb(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ status: string; requesterId: string }>`
          SELECT status, requester_id FROM access_requests WHERE id = ${data.requestId}`
        return rows[0]
      }) as Effect.Effect<{ status: string; requesterId: string } | undefined, never, never>,
    )
    expect(row?.status).toBe("pending")
    expect(row?.requesterId).toBe("p-alice")
  })

  it("'auto_approved' when no approval policy is configured", async () => {
    await seedTestDb(seedAliceAndAppNoPolicy)

    const result = await callAction(action, {
      formData: { intent: "requestAccess", applicationId: "app-jelly", roleId: "role-viewer" },
    })

    const data = expectData<{ outcome: string; requestId?: string }>(result)
    expect(data.outcome).toBe("auto_approved")
  })

  it("'duplicate' when filing the same pending request twice (regression for FiberFailure-mapping bug)", async () => {
    // Requires a policy so the first request stays pending — only then can
    // the unique-pending-request index trip on the second submission.
    await seedTestDb(seedAliceAndApp)

    const first = await callAction(action, {
      formData: { intent: "requestAccess", applicationId: "app-jelly", roleId: "role-viewer" },
    })
    expect(expectData<{ outcome: string }>(first).outcome).toBe("submitted")

    const second = await callAction(action, {
      formData: { intent: "requestAccess", applicationId: "app-jelly", roleId: "role-viewer" },
    })
    expect(expectData<{ outcome: string }>(second).outcome).toBe("duplicate")
  })

  it("'submit_failed' when the principal isn't in the DB", async () => {
    // No seedAliceAndApp — alice doesn't exist as a principal.
    // The Effect's principal_not_found branch falls through to submit_failed.
    const err = vi.spyOn(console, "error").mockImplementation(() => {})

    const result = await callAction(action, {
      formData: { intent: "requestAccess", applicationId: "app-jelly", roleId: "role-viewer" },
    })
    const data = expectData<{ outcome: string; error?: string }>(result)
    expect(data.outcome).toBe("error")
    // No principal → the gen's early return surfaces as a non-mapped _kind.
    // The action collapses anything outside the named cases to a string error.
    expect(data.error).toBeDefined()
    err.mockRestore()
  })
})
