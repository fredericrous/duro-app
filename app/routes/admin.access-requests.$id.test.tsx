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
})
