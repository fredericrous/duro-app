import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { makeTestDbLayer } from "~/lib/db/client.server"
import { GroupSyncService, GroupSyncServiceLive } from "~/lib/governance/GroupSyncService.server"
import { PrincipalRepoLive } from "~/lib/governance/PrincipalRepo.server"
import { GrantRepoLive } from "~/lib/governance/GrantRepo.server"
import { RbacRepoLive } from "~/lib/governance/RbacRepo.server"
import { ApplicationRepoLive } from "~/lib/governance/ApplicationRepo.server"

const TestLayer = Layer.mergeAll(
  GroupSyncServiceLive,
  PrincipalRepoLive,
  GrantRepoLive,
  RbacRepoLive,
  ApplicationRepoLive,
).pipe(Layer.provideMerge(makeTestDbLayer()))

const seedTestData = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
             VALUES ('p-sync-user', 'user', 'syncuser', 'Sync Test User', 'sync@example.com')`
  yield* sql`INSERT INTO principals (id, principal_type, display_name)
             VALUES ('g-alpha', 'group', 'Alpha Group')`
  yield* sql`INSERT INTO principals (id, principal_type, display_name)
             VALUES ('g-beta', 'group', 'Beta Group')`
  yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, owner_id)
             VALUES ('app-sync', 'sync-app', 'Sync App', 'request', 'p-sync-user')`
  yield* sql`INSERT INTO roles (id, application_id, slug, display_name)
             VALUES ('role-sync-admin', 'app-sync', 'sync-admin', 'Sync Admin')`
  yield* sql`INSERT INTO group_mappings (id, oidc_group_name, principal_group_id)
             VALUES ('gm-alpha', 'alpha', 'g-alpha')`
  yield* sql`INSERT INTO group_mappings (id, oidc_group_name, principal_group_id)
             VALUES ('gm-beta', 'beta', 'g-beta')`
  yield* sql`INSERT INTO group_mappings (id, oidc_group_name, role_id, application_id)
             VALUES ('gm-admin', 'admin', 'role-sync-admin', 'app-sync')`
})

describe("GroupSyncService", () => {
  it.layer(TestLayer)("adds group membership", (it) => {
    it.effect("syncGroups with ['alpha'] adds user to g-alpha group", () =>
      Effect.gen(function* () {
        yield* seedTestData
        const svc = yield* GroupSyncService
        const sql = yield* SqlClient.SqlClient

        yield* svc.syncGroups("p-sync-user", ["alpha"])

        const memberships = yield* sql`
          SELECT * FROM group_memberships
          WHERE member_id = 'p-sync-user' AND group_id = 'g-alpha'
        `
        expect(memberships.length).toBe(1)
      }),
    )
  })

  it.layer(TestLayer)("adds membership and auto-synced grant", (it) => {
    it.effect("syncGroups with ['alpha', 'admin'] creates both", () =>
      Effect.gen(function* () {
        yield* seedTestData
        const svc = yield* GroupSyncService
        const sql = yield* SqlClient.SqlClient

        yield* svc.syncGroups("p-sync-user", ["alpha", "admin"])

        const memberships = yield* sql`
          SELECT * FROM group_memberships
          WHERE member_id = 'p-sync-user' AND group_id = 'g-alpha'
        `
        expect(memberships.length).toBe(1)

        const grants = yield* sql`
          SELECT * FROM grants
          WHERE principal_id = 'p-sync-user'
            AND reason = 'auto-synced from OIDC group'
            AND role_id = 'role-sync-admin'
            AND revoked_at IS NULL
        `
        expect(grants.length).toBe(1)
      }),
    )
  })

  it.layer(TestLayer)("switches group membership", (it) => {
    it.effect("syncGroups with ['beta'] after ['alpha'] removes alpha and adds beta", () =>
      Effect.gen(function* () {
        yield* seedTestData
        const svc = yield* GroupSyncService
        const sql = yield* SqlClient.SqlClient

        yield* svc.syncGroups("p-sync-user", ["alpha"])
        yield* svc.syncGroups("p-sync-user", ["beta"])

        const alphaMemberships = yield* sql`
          SELECT * FROM group_memberships
          WHERE member_id = 'p-sync-user' AND group_id = 'g-alpha'
        `
        expect(alphaMemberships.length).toBe(0)

        const betaMemberships = yield* sql`
          SELECT * FROM group_memberships
          WHERE member_id = 'p-sync-user' AND group_id = 'g-beta'
        `
        expect(betaMemberships.length).toBe(1)
      }),
    )
  })

  it.layer(TestLayer)("revokes auto-synced grant", (it) => {
    it.effect("syncGroups with [] after ['admin'] revokes the grant", () =>
      Effect.gen(function* () {
        yield* seedTestData
        const svc = yield* GroupSyncService
        const sql = yield* SqlClient.SqlClient

        yield* svc.syncGroups("p-sync-user", ["admin"])
        yield* svc.syncGroups("p-sync-user", [])

        const grants = yield* sql`
          SELECT * FROM grants
          WHERE principal_id = 'p-sync-user'
            AND reason = 'auto-synced from OIDC group'
            AND role_id = 'role-sync-admin'
        `
        expect(grants.length).toBe(1)
        expect((grants[0] as any).revokedAt).not.toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("idempotent sync", (it) => {
    it.effect("calling syncGroups twice with ['alpha'] is idempotent", () =>
      Effect.gen(function* () {
        yield* seedTestData
        const svc = yield* GroupSyncService
        const sql = yield* SqlClient.SqlClient

        yield* svc.syncGroups("p-sync-user", ["alpha"])
        yield* svc.syncGroups("p-sync-user", ["alpha"])

        const memberships = yield* sql`
          SELECT * FROM group_memberships
          WHERE member_id = 'p-sync-user' AND group_id = 'g-alpha'
        `
        expect(memberships.length).toBe(1)
      }),
    )
  })
})
