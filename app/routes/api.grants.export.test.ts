// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest"

// Run the route's runEffect against the REAL test runtime (PGlite + Live
// repos) — the export is exercised end-to-end: Bearer key → loader → one
// joined SQL query, asserting the actual response JSON.
vi.mock("~/lib/runtime.server", async () => {
  const { testRunEffect } = await import("~/test/test-runtime")
  return { runEffect: testRunEffect }
})

import { Effect } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { loader } from "./api.grants.export"
import { ApiKeyRepo } from "~/lib/governance/ApiKeyRepo.server"
import { GrantRepo } from "~/lib/governance/GrantRepo.server"
import { seedTestDb, truncateAll } from "~/test/test-runtime"
import { callLoader, expectData, expectResponse } from "~/test/route-utils"

function get(rawKey?: string, search = "") {
  return new Request(`http://localhost/api/grants/export${search}`, {
    headers: rawKey ? { Authorization: `Bearer ${rawKey}` } : undefined,
  })
}

/**
 * Seed: admin (granter + API-key owner), alice (user grantee), team group
 * with bob as member, two apps. Grants:
 *  - alice → wiki/editor (active)
 *  - team  → wiki/edit entitlement (active, group)
 *  - alice → tracker/viewer (active, second app for the filter test)
 *  - alice → wiki/editor (revoked)
 *  - alice → wiki/editor (expired)
 */
const seedExportData = (scopes: string[] = ["grants:read"]) =>
  seedTestDb(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email) VALUES
                 ('p-admin', 'user', 'admin', 'Admin', 'admin@example.com'),
                 ('p-alice', 'user', 'alice', 'Alice', 'alice@example.com'),
                 ('p-bob', 'user', 'bob', 'Bob', 'bob@example.com'),
                 ('p-team', 'group', NULL, 'Team', NULL)`
      yield* sql`INSERT INTO group_memberships (group_id, member_id) VALUES ('p-team', 'p-bob')`

      yield* sql`INSERT INTO applications (id, slug, display_name, access_mode) VALUES
                 ('app-wiki', 'wiki', 'Wiki', 'request'),
                 ('app-tracker', 'tracker', 'Tracker', 'request')`
      yield* sql`INSERT INTO roles (id, application_id, slug, display_name) VALUES
                 ('role-editor', 'app-wiki', 'editor', 'Editor'),
                 ('role-viewer', 'app-tracker', 'viewer', 'Viewer')`
      yield* sql`INSERT INTO entitlements (id, application_id, slug, display_name) VALUES
                 ('ent-edit', 'app-wiki', 'edit', 'Edit')`

      const grants = yield* GrantRepo
      yield* grants.grantRole({ principalId: "p-alice", roleId: "role-editor", grantedBy: "p-admin", reason: "cmdb" })
      yield* grants.grantEntitlement({ principalId: "p-team", entitlementId: "ent-edit", grantedBy: "p-admin" })
      yield* grants.grantRole({ principalId: "p-alice", roleId: "role-viewer", grantedBy: "p-admin" })

      const toRevoke = yield* grants.grantRole({ principalId: "p-alice", roleId: "role-editor", grantedBy: "p-admin" })
      yield* grants.revoke(toRevoke.id, "p-admin")
      yield* sql`INSERT INTO grants (id, principal_id, role_id, granted_by, expires_at)
                 VALUES ('grant-expired', 'p-alice', 'role-editor', 'p-admin', NOW() - INTERVAL '1 day')`

      const keys = yield* ApiKeyRepo
      const { rawKey } = yield* keys.create({ principalId: "p-admin", name: "export-key", scopes })
      return rawKey
    }),
  )

beforeEach(async () => {
  await truncateAll()
})

describe("GET /api/grants/export (end-to-end against PGlite)", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = expectResponse(await callLoader(loader, { request: get() }))
    expect(res.status).toBe(401)
  })

  it("rejects a key without the grants:read scope with 403", async () => {
    const rawKey = await seedExportData(["authz:check"])
    const res = expectResponse(await callLoader(loader, { request: get(rawKey) }))
    expect(res.status).toBe(403)
  })

  it("exports active grants with names resolved and group members expanded", async () => {
    const rawKey = await seedExportData()
    const res = expectData<Response>(await callLoader(loader, { request: get(rawKey) }))
    expect(res.status).toBe(200)

    const body = (await res.json()) as { grants: any[]; exportedAt: string }
    expect(new Date(body.exportedAt).toString()).not.toBe("Invalid Date")
    // 3 active grants; the revoked and expired ones are excluded.
    expect(body.grants).toHaveLength(3)

    const aliceWiki = body.grants.find((g) => g.principal.id === "p-alice" && g.application.slug === "wiki")
    expect(aliceWiki).toMatchObject({
      principal: { id: "p-alice", externalId: "alice", displayName: "Alice", principalType: "user" },
      application: { slug: "wiki", displayName: "Wiki" },
      role: { slug: "editor", displayName: "Editor" },
      entitlement: null,
      resource: null,
      members: null,
      grantedBy: { id: "p-admin", externalId: "admin", displayName: "Admin" },
      reason: "cmdb",
      expiresAt: null,
    })
    expect(aliceWiki.id).toBeDefined()
    expect(aliceWiki.createdAt).toBeDefined()

    const teamGrant = body.grants.find((g) => g.principal.id === "p-team")
    expect(teamGrant).toMatchObject({
      principal: { id: "p-team", displayName: "Team", principalType: "group" },
      application: { slug: "wiki", displayName: "Wiki" },
      role: null,
      entitlement: { slug: "edit", displayName: "Edit" },
      members: [{ id: "p-bob", externalId: "bob", displayName: "Bob", email: "bob@example.com" }],
    })
  })

  it("filters by ?application=<slug>", async () => {
    const rawKey = await seedExportData()
    const res = expectData<Response>(await callLoader(loader, { request: get(rawKey, "?application=tracker") }))
    expect(res.status).toBe(200)

    const body = (await res.json()) as { grants: any[] }
    expect(body.grants).toHaveLength(1)
    expect(body.grants[0].application).toEqual({ slug: "tracker", displayName: "Tracker" })
    expect(body.grants[0].role).toEqual({ slug: "viewer", displayName: "Viewer" })

    const none = expectData<Response>(await callLoader(loader, { request: get(rawKey, "?application=nope") }))
    expect(((await none.json()) as { grants: any[] }).grants).toHaveLength(0)
  })
})
