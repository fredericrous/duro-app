import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { makeTestDbLayer } from "~/lib/db/client.server"
import { AuthzEngine, AuthzEngineLive } from "./AuthzEngine.server"
import { PrincipalRepoLive } from "./PrincipalRepo.server"
import { ApplicationRepoLive } from "./ApplicationRepo.server"
import { RbacRepoLive } from "./RbacRepo.server"
import { GrantRepoLive } from "./GrantRepo.server"

const TestLayer = Layer.mergeAll(
  AuthzEngineLive,
  PrincipalRepoLive,
  ApplicationRepoLive,
  RbacRepoLive,
  GrantRepoLive,
).pipe(Layer.provideMerge(makeTestDbLayer()))

// ---------------------------------------------------------------------------
// Helper: seed a minimal data set and return all IDs
// ---------------------------------------------------------------------------

const seedTestData = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  // Principal (user)
  const principalId = "p-test-user"
  yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
             VALUES (${principalId}, 'user', 'testuser', 'Test User', 'test@example.com')`

  // Group + membership
  const groupId = "g-test-group"
  yield* sql`INSERT INTO principals (id, principal_type, display_name)
             VALUES (${groupId}, 'group', 'Test Group')`
  yield* sql`INSERT INTO group_memberships (group_id, member_id) VALUES (${groupId}, ${principalId})`

  // Application
  const appId = "app-test"
  yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, owner_id)
             VALUES (${appId}, 'test-app', 'Test App', 'request', ${principalId})`

  // Role
  const roleId = "role-test-viewer"
  yield* sql`INSERT INTO roles (id, application_id, slug, display_name)
             VALUES (${roleId}, ${appId}, 'viewer', 'Viewer')`

  // Entitlements
  const entReadId = "ent-test-read"
  const entWriteId = "ent-test-write"
  yield* sql`INSERT INTO entitlements (id, application_id, slug, display_name)
             VALUES (${entReadId}, ${appId}, 'read', 'Read')`
  yield* sql`INSERT INTO entitlements (id, application_id, slug, display_name)
             VALUES (${entWriteId}, ${appId}, 'write', 'Write')`

  // Role-entitlement mappings
  yield* sql`INSERT INTO role_entitlements (role_id, entitlement_id) VALUES (${roleId}, ${entReadId})`

  return { principalId, groupId, appId, roleId, entReadId, entWriteId }
})

describe("AuthzEngine", () => {
  it.layer(TestLayer)("allows access via direct entitlement grant", (it) => {
    it.effect("direct entitlement grant is allowed", () =>
      Effect.gen(function* () {
        const engine = yield* AuthzEngine
        const ids = yield* seedTestData
        const sql = yield* SqlClient.SqlClient

        yield* sql`INSERT INTO grants (id, principal_id, entitlement_id, granted_by)
                   VALUES ('grant-direct-ent', ${ids.principalId}, ${ids.entReadId}, ${ids.principalId})`

        const decision = yield* engine.checkAccess({
          subject: "testuser",
          application: "test-app",
          action: "read",
        })

        expect(decision.allow).toBe(true)
        expect(decision.matchedGrantIds).toContain("grant-direct-ent")
      }),
    )
  })

  it.layer(TestLayer)("allows access via role grant (expands entitlements)", (it) => {
    it.effect("role grant expands to entitlements", () =>
      Effect.gen(function* () {
        const engine = yield* AuthzEngine
        const ids = yield* seedTestData
        const sql = yield* SqlClient.SqlClient

        yield* sql`INSERT INTO grants (id, principal_id, role_id, granted_by)
                   VALUES ('grant-role', ${ids.principalId}, ${ids.roleId}, ${ids.principalId})`

        const decision = yield* engine.checkAccess({
          subject: "testuser",
          application: "test-app",
          action: "read",
        })

        expect(decision.allow).toBe(true)
        expect(decision.matchedGrantIds).toContain("grant-role")
      }),
    )
  })

  it.layer(TestLayer)("allows access via group membership", (it) => {
    it.effect("group entitlement grant is allowed for member", () =>
      Effect.gen(function* () {
        const engine = yield* AuthzEngine
        const ids = yield* seedTestData
        const sql = yield* SqlClient.SqlClient

        yield* sql`INSERT INTO grants (id, principal_id, entitlement_id, granted_by)
                   VALUES ('grant-group-ent', ${ids.groupId}, ${ids.entReadId}, ${ids.principalId})`

        const decision = yield* engine.checkAccess({
          subject: "testuser",
          application: "test-app",
          action: "read",
        })

        expect(decision.allow).toBe(true)
        expect(decision.matchedGrantIds).toContain("grant-group-ent")
      }),
    )
  })

  it.layer(TestLayer)("denies access for unknown principal", (it) => {
    it.effect("unknown subject is denied", () =>
      Effect.gen(function* () {
        const engine = yield* AuthzEngine
        yield* seedTestData

        const decision = yield* engine.checkAccess({
          subject: "nobody",
          application: "test-app",
          action: "read",
        })

        expect(decision.allow).toBe(false)
        expect(decision.matchedGrantIds).toHaveLength(0)
        expect(decision.reasons[0]).toContain("Principal not found")
      }),
    )
  })

  it.layer(TestLayer)("denies access when grant is revoked", (it) => {
    it.effect("revoked grant is denied", () =>
      Effect.gen(function* () {
        const engine = yield* AuthzEngine
        const ids = yield* seedTestData
        const sql = yield* SqlClient.SqlClient

        yield* sql`INSERT INTO grants (id, principal_id, entitlement_id, granted_by, revoked_at, revoked_by)
                   VALUES ('grant-revoked', ${ids.principalId}, ${ids.entReadId}, ${ids.principalId}, NOW(), ${ids.principalId})`

        const decision = yield* engine.checkAccess({
          subject: "testuser",
          application: "test-app",
          action: "read",
        })

        expect(decision.allow).toBe(false)
      }),
    )
  })

  it.layer(TestLayer)("denies access when grant is expired", (it) => {
    it.effect("expired grant is denied", () =>
      Effect.gen(function* () {
        const engine = yield* AuthzEngine
        const ids = yield* seedTestData
        const sql = yield* SqlClient.SqlClient

        yield* sql`INSERT INTO grants (id, principal_id, entitlement_id, granted_by, expires_at)
                   VALUES ('grant-expired', ${ids.principalId}, ${ids.entReadId}, ${ids.principalId}, NOW() - INTERVAL '1 day')`

        const decision = yield* engine.checkAccess({
          subject: "testuser",
          application: "test-app",
          action: "read",
        })

        expect(decision.allow).toBe(false)
      }),
    )
  })

  it.layer(TestLayer)("allows app-wide grant regardless of resource", (it) => {
    it.effect("app-wide grant matches any resource", () =>
      Effect.gen(function* () {
        const engine = yield* AuthzEngine
        const ids = yield* seedTestData
        const sql = yield* SqlClient.SqlClient

        yield* sql`INSERT INTO grants (id, principal_id, entitlement_id, granted_by)
                   VALUES ('grant-appwide', ${ids.principalId}, ${ids.entReadId}, ${ids.principalId})`

        const decision = yield* engine.checkAccess({
          subject: "testuser",
          application: "test-app",
          action: "read",
          resourceId: "some-specific-resource",
        })

        expect(decision.allow).toBe(true)
        expect(decision.matchedGrantIds).toContain("grant-appwide")
      }),
    )
  })

  it.layer(TestLayer)("checkBulk returns correct decisions", (it) => {
    it.effect("bulk check returns mixed allow/deny", () =>
      Effect.gen(function* () {
        const engine = yield* AuthzEngine
        const ids = yield* seedTestData
        const sql = yield* SqlClient.SqlClient

        yield* sql`INSERT INTO grants (id, principal_id, entitlement_id, granted_by)
                   VALUES ('grant-bulk-read', ${ids.principalId}, ${ids.entReadId}, ${ids.principalId})`

        const decisions = yield* engine.checkBulk([
          { subject: "testuser", application: "test-app", action: "read" },
          { subject: "testuser", application: "test-app", action: "write" },
          { subject: "nobody", application: "test-app", action: "read" },
        ])

        expect(decisions).toHaveLength(3)
        expect(decisions[0].allow).toBe(true)
        expect(decisions[1].allow).toBe(false)
        expect(decisions[2].allow).toBe(false)
      }),
    )
  })
})
