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
