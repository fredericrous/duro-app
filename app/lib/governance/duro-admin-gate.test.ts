// @vitest-environment node
import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { makeTestDbLayer } from "~/lib/db/client.server"
import { AuthzEngine, AuthzEngineLive } from "./AuthzEngine.server"
import { GroupSyncService, GroupSyncServiceLive } from "./GroupSyncService.server"
import { PrincipalRepoLive } from "./PrincipalRepo.server"
import { ApplicationRepoLive } from "./ApplicationRepo.server"
import { RbacRepoLive } from "./RbacRepo.server"
import { GrantRepoLive } from "./GrantRepo.server"

// Duro's admin gate under AUTH_MODE=governance. Migration 0025 seeds this exact
// config in dev/prod (the migration-check CI validates it against the prod
// clone); makeTestDbLayer truncates seed data for per-test isolation, so we
// re-create the same rows here and prove the end-to-end path: the group-mapping
// materialises into a grant on login sync, which the AuthzEngine then reads to
// allow `duro`/`admin` for lldap_admin members and deny everyone else.
const TestLayer = Layer.mergeAll(
  AuthzEngineLive,
  GroupSyncServiceLive,
  PrincipalRepoLive,
  ApplicationRepoLive,
  RbacRepoLive,
  GrantRepoLive,
).pipe(Layer.provideMerge(makeTestDbLayer()))

// Mirrors migration 0025's rows.
const seedDuroGovernance = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, enabled)
             VALUES ('app-duro', 'duro', 'Duro', 'invite_only', TRUE)`
  yield* sql`INSERT INTO entitlements (id, application_id, slug, display_name)
             VALUES ('ent-duro-admin', 'app-duro', 'admin', 'Administer Duro')`
  yield* sql`INSERT INTO roles (id, application_id, slug, display_name)
             VALUES ('role-duro-admin', 'app-duro', 'admin', 'Administrator')`
  yield* sql`INSERT INTO role_entitlements (role_id, entitlement_id)
             VALUES ('role-duro-admin', 'ent-duro-admin')`
  yield* sql`INSERT INTO group_mappings (id, oidc_group_name, role_id, application_id)
             VALUES ('gm-lldap-admin', 'lldap_admin', 'role-duro-admin', 'app-duro')`
})

describe("duro admin gate under governance (migration 0025 shape)", () => {
  it.layer(TestLayer)("group-mapping drives the admin decision", (it) => {
    it.effect("lldap_admin member is allowed duro/admin after login sync; others denied", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const engine = yield* AuthzEngine
        const sync = yield* GroupSyncService

        yield* seedDuroGovernance
        yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
                   VALUES ('p-admin', 'user', 'admin-sub', 'Admin', 'admin@example.com')`
        yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
                   VALUES ('p-user', 'user', 'user-sub', 'User', 'user@example.com')`

        // Before any login sync, the admin has no grant → denied.
        const before = yield* engine.checkAccess({ subject: "admin-sub", application: "duro", action: "admin" })
        expect(before.allow).toBe(false)

        // Login sync materialises the lldap_admin → duro-admin-role grant.
        yield* sync.syncGroups("p-admin", ["lldap_admin"])
        yield* sync.syncGroups("p-user", ["lldap_users"])

        const admin = yield* engine.checkAccess({ subject: "admin-sub", application: "duro", action: "admin" })
        expect(admin.allow).toBe(true)

        const nonAdmin = yield* engine.checkAccess({ subject: "user-sub", application: "duro", action: "admin" })
        expect(nonAdmin.allow).toBe(false)
      }),
    )
  })
})
