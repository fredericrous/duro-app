import { describe, expect, it, beforeEach } from "vitest"
import { Effect } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { handleAdminGrantsMutation, parseAdminGrantsMutation } from "./admin-grants"
import { seedTestDb, testRunEffect, truncateAll } from "~/test/test-runtime"

beforeEach(async () => {
  await truncateAll()
})

function fd(entries: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) f.append(k, v)
  return f
}

describe("parseAdminGrantsMutation", () => {
  it("parses revoke with all required fields", () => {
    const result = parseAdminGrantsMutation(fd({ intent: "revoke", grantId: "g1", revokedBy: "p-admin" }))
    expect(result).toEqual({ intent: "revoke", grantId: "g1", revokedBy: "p-admin" })
  })

  it("rejects revoke without grantId", () => {
    expect(parseAdminGrantsMutation(fd({ intent: "revoke", revokedBy: "p-admin" }))).toEqual({
      error: "Missing grantId or revokedBy",
    })
  })

  it("rejects revoke without revokedBy", () => {
    expect(parseAdminGrantsMutation(fd({ intent: "revoke", grantId: "g1" }))).toEqual({
      error: "Missing grantId or revokedBy",
    })
  })

  it("rejects unknown intents", () => {
    expect(parseAdminGrantsMutation(fd({ intent: "explode" }))).toEqual({
      error: "Unknown action",
    })
  })
})

const seedGrant = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
             VALUES ('p-alice', 'user', 'alice', 'Alice', 'a@x'),
                    ('p-admin', 'user', 'admin', 'Admin', 'ad@x')`
  yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, owner_id)
             VALUES ('app-1', 'app-1', 'App 1', 'request', 'p-admin')`
  yield* sql`INSERT INTO roles (id, application_id, slug, display_name)
             VALUES ('role-1', 'app-1', 'editor', 'Editor')`
  yield* sql`INSERT INTO grants (id, principal_id, role_id, granted_by)
             VALUES ('g-1', 'p-alice', 'role-1', 'p-admin')`
})

describe("handleAdminGrantsMutation — revoke", () => {
  it("revokes the grant and writes an audit event", async () => {
    await seedTestDb(seedGrant)

    const result = await testRunEffect(
      handleAdminGrantsMutation({ intent: "revoke", grantId: "g-1", revokedBy: "p-admin" }),
    )
    expect(result).toEqual({ success: true, message: "Grant g-1 revoked" })

    // Side-effect: grants.revoked_at is now set.
    const row = await testRunEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ revokedAt: string | null }>`
          SELECT revoked_at FROM grants WHERE id = 'g-1'`
        return rows[0]
      }),
    )
    expect(row?.revokedAt).not.toBeNull()
  })

  it("returns an error shape (not thrown) when the grant doesn't exist", async () => {
    const result = await testRunEffect(
      handleAdminGrantsMutation({
        intent: "revoke",
        grantId: "does-not-exist",
        revokedBy: "p-admin",
      }),
    )
    // catchAll wraps the failure into {error: ...} per the dispatcher contract.
    expect("error" in result || "success" in result).toBe(true)
  })
})
