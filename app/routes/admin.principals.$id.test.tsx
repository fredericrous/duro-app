import { describe, expect, it, vi, beforeEach } from "vitest"
import { Effect } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"

vi.mock("~/lib/runtime.server", async () => {
  const mod = await import("~/test/test-runtime")
  return { runEffect: mod.testRunEffect }
})

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
})
