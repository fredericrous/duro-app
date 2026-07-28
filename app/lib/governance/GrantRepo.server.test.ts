// @vitest-environment node
import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { makeTestDbLayer } from "~/lib/db/client.server"
import { GrantRepo, GrantRepoLive } from "./GrantRepo.server"
import { PrincipalRepoLive } from "./PrincipalRepo.server"
import { ApplicationRepoLive } from "./ApplicationRepo.server"
import { RbacRepoLive } from "./RbacRepo.server"

const TestLayer = Layer.mergeAll(GrantRepoLive, PrincipalRepoLive, ApplicationRepoLive, RbacRepoLive).pipe(
  Layer.provideMerge(makeTestDbLayer()),
)

// ---------------------------------------------------------------------------
// Helper: seed principals, app, role, entitlement
// ---------------------------------------------------------------------------

const seedTestData = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  const principalId = "p-grant-test"
  yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
             VALUES (${principalId}, 'user', 'grantuser', 'Grant User', 'grant@example.com')`

  const appId = "app-grant-test"
  yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, owner_id)
             VALUES (${appId}, 'grant-app', 'Grant App', 'request', ${principalId})`

  const roleId = "role-grant-test"
  yield* sql`INSERT INTO roles (id, application_id, slug, display_name)
             VALUES (${roleId}, ${appId}, 'editor', 'Editor')`

  const entitlementId = "ent-grant-test"
  yield* sql`INSERT INTO entitlements (id, application_id, slug, display_name)
             VALUES (${entitlementId}, ${appId}, 'edit', 'Edit')`

  yield* sql`INSERT INTO role_entitlements (role_id, entitlement_id) VALUES (${roleId}, ${entitlementId})`

  return { principalId, appId, roleId, entitlementId }
})

describe("GrantRepo", () => {
  it.layer(TestLayer)("grantRole creates a grant with role_id", (it) => {
    it.effect("creates grant with correct fields", () =>
      Effect.gen(function* () {
        const repo = yield* GrantRepo
        const ids = yield* seedTestData

        const grant = yield* repo.grantRole({
          principalId: ids.principalId,
          roleId: ids.roleId,
          grantedBy: ids.principalId,
          reason: "test grant",
        })

        expect(grant.id).toBeDefined()
        expect(grant.principalId).toBe(ids.principalId)
        expect(grant.roleId).toBe(ids.roleId)
        expect(grant.entitlementId).toBeNull()
        expect(grant.reason).toBe("test grant")
        expect(grant.revokedAt).toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("grantEntitlement creates a grant with entitlement_id", (it) => {
    it.effect("creates grant with correct fields", () =>
      Effect.gen(function* () {
        const repo = yield* GrantRepo
        const ids = yield* seedTestData

        const grant = yield* repo.grantEntitlement({
          principalId: ids.principalId,
          entitlementId: ids.entitlementId,
          grantedBy: ids.principalId,
          reason: "direct entitlement",
        })

        expect(grant.id).toBeDefined()
        expect(grant.principalId).toBe(ids.principalId)
        expect(grant.entitlementId).toBe(ids.entitlementId)
        expect(grant.roleId).toBeNull()
        expect(grant.reason).toBe("direct entitlement")
        expect(grant.revokedAt).toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("revoke sets revoked_at and revoked_by", (it) => {
    it.effect("revoked grant has timestamp and actor", () =>
      Effect.gen(function* () {
        const repo = yield* GrantRepo
        const ids = yield* seedTestData

        const grant = yield* repo.grantRole({
          principalId: ids.principalId,
          roleId: ids.roleId,
          grantedBy: ids.principalId,
        })

        yield* repo.revoke(grant.id, ids.principalId)

        const revoked = yield* repo.findById(grant.id)
        expect(revoked).not.toBeNull()
        expect(revoked!.revokedAt).not.toBeNull()
        expect(revoked!.revokedBy).toBe(ids.principalId)
      }),
    )
  })

  it.layer(TestLayer)("findActiveForPrincipal excludes revoked grants", (it) => {
    it.effect("revoked grants are filtered out", () =>
      Effect.gen(function* () {
        const repo = yield* GrantRepo
        const ids = yield* seedTestData

        const grant1 = yield* repo.grantRole({
          principalId: ids.principalId,
          roleId: ids.roleId,
          grantedBy: ids.principalId,
        })
        yield* repo.grantEntitlement({
          principalId: ids.principalId,
          entitlementId: ids.entitlementId,
          grantedBy: ids.principalId,
        })

        yield* repo.revoke(grant1.id, ids.principalId)

        const active = yield* repo.findActiveForPrincipal(ids.principalId)
        expect(active).toHaveLength(1)
        expect(active[0].entitlementId).toBe(ids.entitlementId)
      }),
    )
  })

  it.layer(TestLayer)("findActiveForPrincipal excludes expired grants", (it) => {
    it.effect("expired grants are filtered out", () =>
      Effect.gen(function* () {
        const repo = yield* GrantRepo
        const ids = yield* seedTestData
        const sql = yield* SqlClient.SqlClient

        yield* repo.grantEntitlement({
          principalId: ids.principalId,
          entitlementId: ids.entitlementId,
          grantedBy: ids.principalId,
        })

        yield* sql`INSERT INTO grants (id, principal_id, role_id, granted_by, expires_at)
                   VALUES ('grant-expired-test', ${ids.principalId}, ${ids.roleId}, ${ids.principalId}, NOW() - INTERVAL '1 day')`

        const active = yield* repo.findActiveForPrincipal(ids.principalId)
        expect(active).toHaveLength(1)
        expect(active[0].entitlementId).toBe(ids.entitlementId)
      }),
    )
  })

  it.layer(TestLayer)("exportActive resolves names in one joined shape", (it) => {
    it.effect("returns grant with principal, application, role, resource and grantedBy resolved", () =>
      Effect.gen(function* () {
        const repo = yield* GrantRepo
        const ids = yield* seedTestData
        const sql = yield* SqlClient.SqlClient

        yield* sql`INSERT INTO resources (id, application_id, resource_type, external_id, display_name)
                   VALUES ('res-export-test', ${ids.appId}, 'repo', 'repo-42', 'Repo 42')`

        yield* repo.grantRole({
          principalId: ids.principalId,
          roleId: ids.roleId,
          resourceId: "res-export-test",
          grantedBy: ids.principalId,
          reason: "export test",
        })

        const rows = yield* repo.exportActive()
        expect(rows).toHaveLength(1)
        const row = rows[0]
        expect(row.principalId).toBe(ids.principalId)
        expect(row.principalExternalId).toBe("grantuser")
        expect(row.principalDisplayName).toBe("Grant User")
        expect(row.principalEmail).toBe("grant@example.com")
        expect(row.principalType).toBe("user")
        expect(row.applicationSlug).toBe("grant-app")
        expect(row.applicationDisplayName).toBe("Grant App")
        expect(row.roleSlug).toBe("editor")
        expect(row.roleDisplayName).toBe("Editor")
        expect(row.entitlementSlug).toBeNull()
        expect(row.resourceExternalId).toBe("repo-42")
        expect(row.resourceDisplayName).toBe("Repo 42")
        expect(row.grantedById).toBe(ids.principalId)
        expect(row.grantedByExternalId).toBe("grantuser")
        expect(row.grantedByDisplayName).toBe("Grant User")
        expect(row.reason).toBe("export test")
        expect(row.expiresAt).toBeNull()
        expect(row.createdAt).toBeDefined()
        expect(row.members).toBeNull() // user grantee → no members array
      }),
    )
  })

  it.layer(TestLayer)("exportActive expands group grantees", (it) => {
    it.effect("group grant carries single-hop members; entitlement side resolved", () =>
      Effect.gen(function* () {
        const repo = yield* GrantRepo
        const ids = yield* seedTestData
        const sql = yield* SqlClient.SqlClient

        yield* sql`INSERT INTO principals (id, principal_type, display_name)
                   VALUES ('p-team', 'group', 'Team')`
        yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
                   VALUES ('p-member', 'user', 'memberuser', 'Member User', 'member@example.com')`
        yield* sql`INSERT INTO group_memberships (group_id, member_id) VALUES ('p-team', 'p-member')`

        yield* repo.grantEntitlement({
          principalId: "p-team",
          entitlementId: ids.entitlementId,
          grantedBy: ids.principalId,
        })

        const rows = yield* repo.exportActive()
        expect(rows).toHaveLength(1)
        const row = rows[0]
        expect(row.principalType).toBe("group")
        expect(row.roleSlug).toBeNull()
        expect(row.entitlementSlug).toBe("edit")
        expect(row.entitlementDisplayName).toBe("Edit")
        expect(row.members).toEqual([
          {
            id: "p-member",
            externalId: "memberuser",
            displayName: "Member User",
            email: "member@example.com",
            principalType: "user",
          },
        ])
      }),
    )
  })

  it.layer(TestLayer)("exportActive returns only active grants", (it) => {
    it.effect("revoked and expired grants are excluded", () =>
      Effect.gen(function* () {
        const repo = yield* GrantRepo
        const ids = yield* seedTestData
        const sql = yield* SqlClient.SqlClient

        const keeper = yield* repo.grantRole({
          principalId: ids.principalId,
          roleId: ids.roleId,
          grantedBy: ids.principalId,
        })

        const revoked = yield* repo.grantEntitlement({
          principalId: ids.principalId,
          entitlementId: ids.entitlementId,
          grantedBy: ids.principalId,
        })
        yield* repo.revoke(revoked.id, ids.principalId)

        yield* sql`INSERT INTO grants (id, principal_id, role_id, granted_by, expires_at)
                   VALUES ('grant-export-expired', ${ids.principalId}, ${ids.roleId}, ${ids.principalId}, NOW() - INTERVAL '1 day')`

        const rows = yield* repo.exportActive()
        expect(rows).toHaveLength(1)
        expect(rows[0].id).toBe(keeper.id)
      }),
    )
  })

  it.layer(TestLayer)("exportActive filters by application slug", (it) => {
    it.effect("only grants on the requested app are returned", () =>
      Effect.gen(function* () {
        const repo = yield* GrantRepo
        const ids = yield* seedTestData
        const sql = yield* SqlClient.SqlClient

        yield* sql`INSERT INTO applications (id, slug, display_name, access_mode)
                   VALUES ('app-other-test', 'other-app', 'Other App', 'request')`
        yield* sql`INSERT INTO roles (id, application_id, slug, display_name)
                   VALUES ('role-other-test', 'app-other-test', 'viewer', 'Viewer')`

        yield* repo.grantRole({ principalId: ids.principalId, roleId: ids.roleId, grantedBy: ids.principalId })
        yield* repo.grantRole({ principalId: ids.principalId, roleId: "role-other-test", grantedBy: ids.principalId })

        const filtered = yield* repo.exportActive({ applicationSlug: "other-app" })
        expect(filtered).toHaveLength(1)
        expect(filtered[0].applicationSlug).toBe("other-app")
        expect(filtered[0].roleSlug).toBe("viewer")

        const all = yield* repo.exportActive()
        expect(all).toHaveLength(2)

        const none = yield* repo.exportActive({ applicationSlug: "no-such-app" })
        expect(none).toHaveLength(0)
      }),
    )
  })

  it.layer(TestLayer)("findExpired returns expired grants", (it) => {
    it.effect("only expired non-revoked grants are returned", () =>
      Effect.gen(function* () {
        const repo = yield* GrantRepo
        const ids = yield* seedTestData
        const sql = yield* SqlClient.SqlClient

        yield* repo.grantEntitlement({
          principalId: ids.principalId,
          entitlementId: ids.entitlementId,
          grantedBy: ids.principalId,
        })

        yield* sql`INSERT INTO grants (id, principal_id, role_id, granted_by, expires_at)
                   VALUES ('grant-find-expired', ${ids.principalId}, ${ids.roleId}, ${ids.principalId}, NOW() - INTERVAL '1 hour')`

        const expired = yield* repo.findExpired()
        expect(expired.length).toBeGreaterThanOrEqual(1)
        const found = expired.find((g) => g.id === "grant-find-expired")
        expect(found).toBeDefined()
        expect(found!.roleId).toBe(ids.roleId)

        const nonExpired = expired.find((g) => g.entitlementId === ids.entitlementId)
        expect(nonExpired).toBeUndefined()
      }),
    )
  })
})
