import * as PgClient from "@effect/sql-pg/PgClient"
import * as SqlClient from "@effect/sql/SqlClient"
import * as SqlError from "@effect/sql/SqlError"
import { Context, Config, Effect, Layer } from "effect"
import * as crypto from "node:crypto"

import m0001 from "./migrations/pg/0001_create_schema"
import m0002 from "./migrations/pg/0002_create_user_revocations"
import m0003 from "./migrations/pg/0003_add_revert_pr_columns"
import m0004 from "./migrations/pg/0004_add_locale"
import m0005 from "./migrations/pg/0005_add_cert_renewal_tracking"
import m0006 from "./migrations/pg/0006_create_user_certificates"
import m0007 from "./migrations/pg/0007_create_governance_core"
import m0008 from "./migrations/pg/0008_create_rbac_model"
import m0009 from "./migrations/pg/0009_create_access_requests"
import m0010 from "./migrations/pg/0010_create_provisioning"

const snakeToCamel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

// ---------------------------------------------------------------------------
// PgClient layer (Config-driven — resolves DATABASE_URL at layer build time)
// ---------------------------------------------------------------------------

const PgClientLive = Layer.unwrapEffect(
  Config.redacted("DATABASE_URL").pipe(
    Effect.map((url) =>
      PgClient.layer({
        url,
        transformResultNames: snakeToCamel,
      }),
    ),
  ),
)

// ---------------------------------------------------------------------------
// Migration marker — InviteRepo depends on this to guarantee ordering
// ---------------------------------------------------------------------------

export class MigrationsRan extends Context.Tag("MigrationsRan")<MigrationsRan, true>() {}

// ---------------------------------------------------------------------------
// Lightweight migration runner
// ---------------------------------------------------------------------------

const migrations: Array<
  [id: number, name: string, effect: Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient>]
> = [
  [1, "create_schema", m0001],
  [2, "create_user_revocations", m0002],
  [3, "add_revert_pr_columns", m0003],
  [4, "add_locale", m0004],
  [5, "add_cert_renewal_tracking", m0005],
  [6, "create_user_certificates", m0006],
  [7, "create_governance_core", m0007],
  [8, "create_rbac_model", m0008],
  [9, "create_access_requests", m0009],
  [10, "create_provisioning", m0010],
]

const runMigrations = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `

  const applied = yield* sql`SELECT id FROM _migrations ORDER BY id`
  const appliedIds = new Set(applied.map((r: any) => r.id))

  yield* Effect.log(`migrations: discovered ${migrations.length}, already applied ${appliedIds.size}`)

  let newCount = 0
  for (const [id, name, migration] of migrations) {
    if (appliedIds.has(id)) continue
    yield* migration.pipe(Effect.tapError((e) => Effect.logError(`migration ${id}_${name} failed`, e)))
    yield* sql`INSERT INTO _migrations (id, name) VALUES (${id}, ${name})`
    yield* Effect.log(`migration ${id}_${name} applied`)
    newCount++
  }

  if (newCount > 0) {
    yield* Effect.log(`migrations: ${newCount} new migration(s) applied`)
  } else {
    yield* Effect.log(`migrations: all ${migrations.length} already applied, nothing to do`)
  }
})

// ---------------------------------------------------------------------------
// Combined layer: Client + migrations
// ---------------------------------------------------------------------------

export const MigratorLive = Layer.effect(MigrationsRan, runMigrations.pipe(Effect.as(true as const)))

/**
 * Combined layer: Client + migrations.
 * Provides SqlClient.SqlClient and MigrationsRan.
 * Migrations run before any downstream layer is built.
 */
export const DbLive = MigratorLive.pipe(Layer.provideMerge(PgClientLive))

/**
 * Dev layer: uses an in-memory PGlite instance (no external Postgres needed).
 * Data persists for the lifetime of the dev server process.
 */
const PgLiteClientLayer = PgClient.layerFromPool({
  acquire: Effect.acquireRelease(
    Effect.promise(async () => {
      const { createPglitePool } = await import("./pglite-pool")
      return createPglitePool()
    }),
    (pool) => Effect.promise(() => pool.end()),
  ),
  transformResultNames: snakeToCamel,
})

const seedDevData = Effect.gen(function* () {
  yield* runMigrations
  const sql = yield* SqlClient.SqlClient

  // Only seed if empty
  const existing = yield* sql`SELECT COUNT(*) as count FROM user_certificates`
  if (Number(existing[0].count) > 0) return

  yield* Effect.log("seeding dev data")
  const now = new Date().toISOString()
  const expires = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()

  const users = [
    { id: "dev", email: "dev@localhost", serial: "aa:bb:cc:dd:00:00:00:01" },
    { id: "alice", email: "alice@example.com", serial: "aa:bb:cc:dd:00:00:00:02" },
    { id: "alice", email: "alice@example.com", serial: "aa:bb:cc:dd:00:00:00:04" },
    { id: "alice", email: "alice@example.com", serial: "aa:bb:cc:dd:00:00:00:05" },
    { id: "bob", email: "bob@example.com", serial: "aa:bb:cc:dd:00:00:00:03" },
  ]

  for (const u of users) {
    yield* sql`
      INSERT INTO user_certificates (id, invite_id, user_id, username, email, serial_number, issued_at, expires_at)
      VALUES (${crypto.randomUUID()}, ${crypto.randomUUID()}, ${u.id}, ${u.id}, ${u.email}, ${u.serial}, ${now}, ${expires})
    `
  }
  yield* Effect.log("dev seed complete: 3 users with certificates (alice has 3)")

  // --- Governance seed (separate sentinel) ---
  yield* seedGovernanceData(sql)
}).pipe(Effect.as(true as const))

const seedGovernanceData = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    const existing = yield* sql`SELECT COUNT(*) as count FROM principals`
    if (Number(existing[0].count) > 0) return

    yield* Effect.log("seeding governance data")

    // --- Principals ---
    const devId = "p-dev"
    const aliceId = "p-alice"
    const bobId = "p-bob"
    const familyGroupId = "g-family"
    const mediaGroupId = "g-media"

    yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email) VALUES (${devId}, 'user', 'dev', 'dev', 'dev@localhost')`
    yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email) VALUES (${aliceId}, 'user', 'alice', 'Alice', 'alice@example.com')`
    yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email) VALUES (${bobId}, 'user', 'bob', 'Bob', 'bob@example.com')`
    yield* sql`INSERT INTO principals (id, principal_type, display_name) VALUES (${familyGroupId}, 'group', 'Family')`
    yield* sql`INSERT INTO principals (id, principal_type, display_name) VALUES (${mediaGroupId}, 'group', 'Media')`

    // --- Group memberships ---
    yield* sql`INSERT INTO group_memberships (group_id, member_id) VALUES (${familyGroupId}, ${devId})`
    yield* sql`INSERT INTO group_memberships (group_id, member_id) VALUES (${familyGroupId}, ${aliceId})`
    yield* sql`INSERT INTO group_memberships (group_id, member_id) VALUES (${familyGroupId}, ${bobId})`
    yield* sql`INSERT INTO group_memberships (group_id, member_id) VALUES (${mediaGroupId}, ${devId})`
    yield* sql`INSERT INTO group_memberships (group_id, member_id) VALUES (${mediaGroupId}, ${aliceId})`

    // --- Applications ---
    const duroAppId = "app-duro"
    const kbAppId = "app-kb-vision"
    const jellyfinAppId = "app-jellyfin"
    const grafanaAppId = "app-grafana"

    yield* sql`INSERT INTO applications (id, slug, display_name, description, access_mode, owner_id) VALUES (${duroAppId}, 'duro', 'Duro', 'Access governance platform', 'request', ${devId})`
    yield* sql`INSERT INTO applications (id, slug, display_name, description, access_mode, owner_id) VALUES (${kbAppId}, 'kb-vision', 'KB Vision', 'Knowledge base', 'request', ${devId})`
    yield* sql`INSERT INTO applications (id, slug, display_name, description, access_mode, owner_id) VALUES (${jellyfinAppId}, 'jellyfin', 'Jellyfin', 'Media server', 'invite_only', ${devId})`
    yield* sql`INSERT INTO applications (id, slug, display_name, description, access_mode, owner_id) VALUES (${grafanaAppId}, 'grafana', 'Grafana', 'Monitoring dashboards', 'open', ${devId})`

    // --- Roles ---
    const duroAdminRoleId = "role-duro-admin"
    const kbViewerRoleId = "role-kb-viewer"
    const kbEditorRoleId = "role-kb-editor"
    const jfViewerRoleId = "role-jf-viewer"
    const jfAdminRoleId = "role-jf-admin"
    const grafanaEditorRoleId = "role-grafana-editor"

    yield* sql`INSERT INTO roles (id, application_id, slug, display_name, description) VALUES (${duroAdminRoleId}, ${duroAppId}, 'admin', 'Admin', 'Full admin access')`
    yield* sql`INSERT INTO roles (id, application_id, slug, display_name, description) VALUES (${kbViewerRoleId}, ${kbAppId}, 'viewer', 'Viewer', 'Read-only access')`
    yield* sql`INSERT INTO roles (id, application_id, slug, display_name, description) VALUES (${kbEditorRoleId}, ${kbAppId}, 'editor', 'Editor', 'Read-write access')`
    yield* sql`INSERT INTO roles (id, application_id, slug, display_name, description) VALUES (${jfViewerRoleId}, ${jellyfinAppId}, 'viewer', 'Viewer', 'Stream media')`
    yield* sql`INSERT INTO roles (id, application_id, slug, display_name, description) VALUES (${jfAdminRoleId}, ${jellyfinAppId}, 'admin', 'Admin', 'Manage library')`
    yield* sql`INSERT INTO roles (id, application_id, slug, display_name, description) VALUES (${grafanaEditorRoleId}, ${grafanaAppId}, 'editor', 'Editor', 'Edit dashboards')`

    // --- Entitlements ---
    const kbReadId = "ent-kb-read"
    const kbWriteId = "ent-kb-write"
    const jfStreamId = "ent-jf-stream"
    const jfManageId = "ent-jf-manage"
    const grafViewId = "ent-graf-view"
    const grafEditId = "ent-graf-edit"
    const duroAdminEntId = "ent-duro-admin"
    const duroAccessEntId = "ent-duro-access"

    yield* sql`INSERT INTO entitlements (id, application_id, slug, display_name) VALUES (${duroAdminEntId}, ${duroAppId}, 'admin', 'Admin access')`
    yield* sql`INSERT INTO entitlements (id, application_id, slug, display_name) VALUES (${duroAccessEntId}, ${duroAppId}, 'access', 'Basic access')`
    yield* sql`INSERT INTO entitlements (id, application_id, slug, display_name) VALUES (${kbReadId}, ${kbAppId}, 'space.read', 'Read spaces')`
    yield* sql`INSERT INTO entitlements (id, application_id, slug, display_name) VALUES (${kbWriteId}, ${kbAppId}, 'space.write', 'Write spaces')`
    yield* sql`INSERT INTO entitlements (id, application_id, slug, display_name) VALUES (${jfStreamId}, ${jellyfinAppId}, 'stream', 'Stream media')`
    yield* sql`INSERT INTO entitlements (id, application_id, slug, display_name) VALUES (${jfManageId}, ${jellyfinAppId}, 'manage_library', 'Manage library')`
    yield* sql`INSERT INTO entitlements (id, application_id, slug, display_name) VALUES (${grafViewId}, ${grafanaAppId}, 'dashboard.view', 'View dashboards')`
    yield* sql`INSERT INTO entitlements (id, application_id, slug, display_name) VALUES (${grafEditId}, ${grafanaAppId}, 'dashboard.edit', 'Edit dashboards')`

    // --- Role-entitlement mappings ---
    yield* sql`INSERT INTO role_entitlements (role_id, entitlement_id) VALUES (${duroAdminRoleId}, ${duroAdminEntId})`
    yield* sql`INSERT INTO role_entitlements (role_id, entitlement_id) VALUES (${duroAdminRoleId}, ${duroAccessEntId})`
    yield* sql`INSERT INTO role_entitlements (role_id, entitlement_id) VALUES (${kbViewerRoleId}, ${kbReadId})`
    yield* sql`INSERT INTO role_entitlements (role_id, entitlement_id) VALUES (${kbEditorRoleId}, ${kbReadId})`
    yield* sql`INSERT INTO role_entitlements (role_id, entitlement_id) VALUES (${kbEditorRoleId}, ${kbWriteId})`
    yield* sql`INSERT INTO role_entitlements (role_id, entitlement_id) VALUES (${jfViewerRoleId}, ${jfStreamId})`
    yield* sql`INSERT INTO role_entitlements (role_id, entitlement_id) VALUES (${jfAdminRoleId}, ${jfStreamId})`
    yield* sql`INSERT INTO role_entitlements (role_id, entitlement_id) VALUES (${jfAdminRoleId}, ${jfManageId})`
    yield* sql`INSERT INTO role_entitlements (role_id, entitlement_id) VALUES (${grafanaEditorRoleId}, ${grafViewId})`
    yield* sql`INSERT INTO role_entitlements (role_id, entitlement_id) VALUES (${grafanaEditorRoleId}, ${grafEditId})`

    // --- Grants ---
    // dev has admin on duro (direct)
    yield* sql`INSERT INTO grants (id, principal_id, role_id, granted_by, reason) VALUES ('grant-dev-duro', ${devId}, ${duroAdminRoleId}, ${devId}, 'bootstrap')`
    // dev has admin on kb-vision (direct)
    yield* sql`INSERT INTO grants (id, principal_id, role_id, granted_by, reason) VALUES ('grant-dev-kb', ${devId}, ${kbEditorRoleId}, ${devId}, 'bootstrap')`
    // family group has viewer on kb-vision (alice and bob get it via group)
    yield* sql`INSERT INTO grants (id, principal_id, role_id, granted_by, reason) VALUES ('grant-family-kb', ${familyGroupId}, ${kbViewerRoleId}, ${devId}, 'group grant')`
    // bob has viewer on jellyfin (direct)
    yield* sql`INSERT INTO grants (id, principal_id, role_id, granted_by, reason) VALUES ('grant-bob-jf', ${bobId}, ${jfViewerRoleId}, ${devId}, 'direct grant')`

    // --- Approval policy: kb-vision requires one_of approval from app owner ---
    yield* sql`INSERT INTO approval_policies (id, application_id, scope_type, mode, rules) VALUES ('policy-kb', ${kbAppId}, 'application', 'one_of', ${JSON.stringify([{ approverType: "app_owner" }])})`

    // --- Pending access request: bob wants kb-vision editor ---
    const requestId = "req-bob-kb-editor"
    yield* sql`INSERT INTO access_requests (id, requester_id, application_id, role_id, justification, status) VALUES (${requestId}, ${bobId}, ${kbAppId}, ${kbEditorRoleId}, 'Need to edit knowledge base articles', 'pending')`
    yield* sql`INSERT INTO request_approvals (id, request_id, approver_id) VALUES ('approval-bob-kb', ${requestId}, ${devId})`

    // --- Group mappings (OIDC → governance) ---
    yield* sql`INSERT INTO group_mappings (id, oidc_group_name, principal_group_id) VALUES ('gm-family', 'family', ${familyGroupId})`
    yield* sql`INSERT INTO group_mappings (id, oidc_group_name, principal_group_id) VALUES ('gm-media', 'media', ${mediaGroupId})`
    yield* sql`INSERT INTO group_mappings (id, oidc_group_name, role_id, application_id) VALUES ('gm-admin', 'lldap_admin', ${duroAdminRoleId}, ${duroAppId})`

    // --- API key for dev testing ---
    const devApiKey = "duro_dev_test_key_0000000000000000"
    const keyHash = crypto.createHash("sha256").update(devApiKey).digest("hex")
    yield* sql`INSERT INTO api_keys (id, principal_id, key_hash, name, scopes) VALUES ('apikey-dev', ${devId}, ${keyHash}, 'Dev Test Key', ${JSON.stringify(["*"])})`

    yield* Effect.log("governance seed complete: 4 apps, 6 roles, 8 entitlements, 4 grants, 1 policy, 1 pending request")
  })

export const DbDevLive = Layer.effect(MigrationsRan, seedDevData).pipe(Layer.provideMerge(PgLiteClientLayer))

/**
 * Test layer: uses an in-memory PGlite instance (no external Postgres needed).
 * Runs migrations then truncates all data tables for a clean test state.
 */
export const makeTestDbLayer = () => {
  const migrateAndClean = Effect.gen(function* () {
    yield* runMigrations
    const sql = yield* SqlClient.SqlClient
    yield* sql`TRUNCATE
      provisioning_jobs, connector_mappings, connected_systems,
      api_keys, audit_events, access_invitations,
      request_approvals, access_requests, approval_policies,
      grants, role_entitlements, entitlements, roles, resources,
      group_mappings, applications, group_memberships, principals,
      invites, user_revocations, user_preferences, user_certificates
      RESTART IDENTITY CASCADE`
  }).pipe(Effect.as(true as const))

  return Layer.effect(MigrationsRan, migrateAndClean).pipe(Layer.provideMerge(PgLiteClientLayer))
}
