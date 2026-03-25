import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { makeTestDbLayer } from "~/lib/db/client.server"
import { GrantRepo, GrantRepoLive } from "./GrantRepo.server"
import { PrincipalRepoLive } from "./PrincipalRepo.server"
import { ApplicationRepoLive } from "./ApplicationRepo.server"
import { RbacRepoLive } from "./RbacRepo.server"

const TestLayer = Layer.mergeAll(
  GrantRepoLive,
  PrincipalRepoLive,
  ApplicationRepoLive,
  RbacRepoLive,
).pipe(Layer.provideMerge(makeTestDbLayer()))

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
