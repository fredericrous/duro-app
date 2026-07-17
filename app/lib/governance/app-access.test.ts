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

// Governance app-visibility (migration 0026 shape). makeTestDbLayer truncates
// seed data, so re-create the relevant rows: admins see every app via the duro
// admin role bundling each app's `access` entitlement; a group (family) sees a
// subset via a group principal with direct access grants. Verifies the
// `action:"access"` decisions that home.tsx drives the app grid off.
const TestLayer = Layer.mergeAll(
  AuthzEngineLive,
  GroupSyncServiceLive,
  PrincipalRepoLive,
  ApplicationRepoLive,
  RbacRepoLive,
  GrantRepoLive,
).pipe(Layer.provideMerge(makeTestDbLayer()))

const seed = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  // duro app + admin role/entitlement (0025 shape)
  yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, enabled) VALUES ('app-duro','duro','Duro','invite_only',TRUE)`
  yield* sql`INSERT INTO entitlements (id, application_id, slug, display_name) VALUES ('ent-duro-admin','app-duro','admin','Admin')`
  yield* sql`INSERT INTO roles (id, application_id, slug, display_name) VALUES ('role-admin','app-duro','admin','Administrator')`
  yield* sql`INSERT INTO role_entitlements (role_id, entitlement_id) VALUES ('role-admin','ent-duro-admin')`
  yield* sql`INSERT INTO group_mappings (id, oidc_group_name, role_id, application_id) VALUES ('gm-admin','lldap_admin','role-admin','app-duro')`
  // two sample apps with access entitlements (0026 shape)
  yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, enabled) VALUES ('app-nc','nextcloud','Nextcloud','request',TRUE),('app-sonarr','sonarr','Sonarr','request',TRUE)`
  yield* sql`INSERT INTO entitlements (id, application_id, slug, display_name) VALUES ('ent-nc','app-nc','access','Access'),('ent-sonarr','app-sonarr','access','Access')`
  // admins see every app: bundle access into the admin role
  yield* sql`INSERT INTO role_entitlements (role_id, entitlement_id) VALUES ('role-admin','ent-nc'),('role-admin','ent-sonarr')`
  // family group principal: access to nextcloud only
  yield* sql`INSERT INTO principals (id, principal_type, display_name) VALUES ('grp-family','group','Family')`
  yield* sql`INSERT INTO grants (principal_id, entitlement_id, granted_by, reason) VALUES ('grp-family','ent-nc','grp-family','seed')`
  yield* sql`INSERT INTO group_mappings (id, oidc_group_name, principal_group_id) VALUES ('gm-family','family','grp-family')`
})

describe("governance app visibility (migration 0026 shape)", () => {
  it.layer(TestLayer)("access decisions drive the home grid", (it) => {
    it.effect("admins see every app; a family member sees only its subset", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const engine = yield* AuthzEngine
        const sync = yield* GroupSyncService

        yield* seed
        yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name) VALUES ('p-admin','user','admin-sub','Admin')`
        yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name) VALUES ('p-fam','user','fam-sub','Fam')`

        yield* sync.syncGroups("p-admin", ["lldap_admin"])
        yield* sync.syncGroups("p-fam", ["family"])

        // Admin: access to both apps (via the admin role bundling every access ent).
        expect(
          (yield* engine.checkAccess({ subject: "admin-sub", application: "nextcloud", action: "access" })).allow,
        ).toBe(true)
        expect(
          (yield* engine.checkAccess({ subject: "admin-sub", application: "sonarr", action: "access" })).allow,
        ).toBe(true)

        // Family: access to nextcloud (in the group's grants) but NOT sonarr.
        expect(
          (yield* engine.checkAccess({ subject: "fam-sub", application: "nextcloud", action: "access" })).allow,
        ).toBe(true)
        expect((yield* engine.checkAccess({ subject: "fam-sub", application: "sonarr", action: "access" })).allow).toBe(
          false,
        )
      }),
    )
  })
})
