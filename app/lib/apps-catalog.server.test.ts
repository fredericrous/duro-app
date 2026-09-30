// @vitest-environment node
import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { makeTestDbLayer } from "~/lib/db/client.server"
import { AuthzEngineLive } from "~/lib/governance/AuthzEngine.server"
import { ApplicationRepoLive } from "~/lib/governance/ApplicationRepo.server"
import { GrantRepoLive } from "~/lib/governance/GrantRepo.server"
import { AccessRequestRepoLive } from "~/lib/governance/AccessRequestRepo.server"
import { loadAppsCatalogForPrincipal } from "./apps-catalog.server"

const TestLayer = Layer.mergeAll(AuthzEngineLive, ApplicationRepoLive, GrantRepoLive, AccessRequestRepoLive).pipe(
  Layer.provideMerge(makeTestDbLayer()),
)

/**
 * An admin whose access to every app comes from the duro admin role's bundle
 * of `access` entitlements (migrations 0025/0026), not from a role on the app,
 * plus a member of a group granted access to one app. Both used to read as
 * "Request access" / "Ask an admin" on /catalog.
 */
const seed = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name)
             VALUES ('p-admin', 'user', 'admin-sub', 'Admin User'),
                    ('p-member', 'user', 'member-sub', 'Member User'),
                    ('g-family', 'group', NULL, 'Family')`
  yield* sql`INSERT INTO group_memberships (group_id, member_id) VALUES ('g-family', 'p-member')`

  // Two request-mode apps: one with a role the admin does not hold, one
  // invite-only. Each gets the `access` entitlement.
  yield* sql`INSERT INTO applications (id, slug, display_name, access_mode)
             VALUES ('app-wiki', 'wiki', 'Wiki', 'request'), ('app-crm', 'crm', 'CRM', 'invite_only')`
  yield* sql`INSERT INTO roles (id, application_id, slug, display_name) VALUES ('role-wiki-editor', 'app-wiki', 'editor', 'Editor')`
  yield* sql`INSERT INTO entitlements (id, application_id, slug, display_name)
             VALUES ('ent-wiki-access', 'app-wiki', 'access', 'Access'), ('ent-crm-access', 'app-crm', 'access', 'Access')`

  // The duro portal and its admin role, as migration 0025 seeds them (the
  // test database is truncated after migrating), bundling both apps' access.
  yield* sql`INSERT INTO applications (id, slug, display_name, access_mode)
             VALUES ('app-duro', 'duro', 'Duro', 'invite_only') ON CONFLICT (slug) DO NOTHING`
  const [duro] = yield* sql<{ id: string }>`SELECT id FROM applications WHERE slug = 'duro'`
  yield* sql`INSERT INTO roles (id, application_id, slug, display_name)
             VALUES ('role-duro-admin', ${duro!.id}, 'admin', 'Administrator')`
  yield* sql`INSERT INTO role_entitlements (role_id, entitlement_id)
             VALUES ('role-duro-admin', 'ent-wiki-access'), ('role-duro-admin', 'ent-crm-access')`
  yield* sql`INSERT INTO grants (id, principal_id, role_id, granted_by)
             VALUES ('grant-admin', 'p-admin', 'role-duro-admin', 'p-admin')`
  // The family group gets wiki access directly.
  yield* sql`INSERT INTO grants (id, principal_id, entitlement_id, granted_by)
             VALUES ('grant-family', 'g-family', 'ent-wiki-access', 'p-admin')`
})

describe("loadAppsCatalogForPrincipal", () => {
  it.layer(TestLayer)("access that does not come from a role on the app", (it) => {
    it.effect("an admin sees granted apps and where the access comes from", () =>
      Effect.gen(function* () {
        yield* seed
        const catalog = yield* loadAppsCatalogForPrincipal("p-admin")
        const wiki = catalog.find((e) => e.app.slug === "wiki")!
        const crm = catalog.find((e) => e.app.slug === "crm")!

        // Access through the bundle reads as Granted, not Partial; the Editor
        // role stays requestable as an action.
        expect(wiki.state).toBe("granted_full")
        expect(wiki.requestableRoleIds).toHaveLength(1)
        expect(wiki.accessVia).toEqual([{ role: "Administrator", roleApp: "Duro", entitlement: null, group: null }])
        // Invite-only: nothing more to ask for — not "Ask an admin".
        expect(crm.state).toBe("granted_full")
        expect(crm.accessVia[0]).toMatchObject({ roleApp: "Duro" })
      }),
    )

    it.effect("a group member sees the group it comes through", () =>
      Effect.gen(function* () {
        const catalog = yield* loadAppsCatalogForPrincipal("p-member")
        const wiki = catalog.find((e) => e.app.slug === "wiki")!
        const crm = catalog.find((e) => e.app.slug === "crm")!
        expect(wiki.state).toBe("granted_full")
        expect(wiki.accessVia).toEqual([{ role: null, roleApp: null, entitlement: "Access", group: "Family" }])
        expect(crm.state).toBe("invite_only")
        expect(crm.accessVia).toEqual([])
      }),
    )
  })
})
