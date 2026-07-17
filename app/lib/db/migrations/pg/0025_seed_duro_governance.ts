import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

/**
 * Seed the governance model so Duro's own admin gate works under
 * `AUTH_MODE=governance`.
 *
 * `checkAuthDecision({ application: "duro", action: "admin" })` runs the
 * AuthzEngine, which (1) resolves the `duro` application by slug and (2) allows
 * the action only if the principal holds an entitlement whose slug equals the
 * action ("admin") on that app. Until now none of that existed — `duro` wasn't
 * even a registered application — so governance mode would deny every admin
 * request. This registers the minimum model:
 *   - the `duro` application (must be enabled for the engine to resolve it),
 *   - an `admin` entitlement (the slug the engine matches against),
 *   - an `admin` role bundling it,
 *   - a group-mapping `lldap_admin` → the admin role.
 *
 * The mapping mirrors the legacy check (`auth.groups.includes(adminGroupName)`,
 * default `lldap_admin`): on OIDC login `GroupSyncService.syncGroups` turns it
 * into an auto-synced role grant, so admins get access by group membership
 * exactly as before — no per-user grant to hardcode here. (An existing session
 * must re-login once after the cutover for its grant to materialize.)
 *
 * Idempotent: every insert is guarded by the tables' unique constraints.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    INSERT INTO applications (slug, display_name, description, access_mode, enabled)
    VALUES ('duro', 'Duro', 'Access-governance portal (self)', 'invite_only', TRUE)
    ON CONFLICT (slug) DO NOTHING
  `

  yield* sql`
    INSERT INTO entitlements (application_id, slug, display_name, description)
    SELECT id, 'admin', 'Administer Duro', 'Full access to the Duro admin console'
    FROM applications WHERE slug = 'duro'
    ON CONFLICT (application_id, slug) DO NOTHING
  `

  yield* sql`
    INSERT INTO roles (application_id, slug, display_name, description)
    SELECT id, 'admin', 'Administrator', 'Duro administrators'
    FROM applications WHERE slug = 'duro'
    ON CONFLICT (application_id, slug) DO NOTHING
  `

  yield* sql`
    INSERT INTO role_entitlements (role_id, entitlement_id)
    SELECT r.id, e.id
    FROM applications a
    JOIN roles r ON r.application_id = a.id AND r.slug = 'admin'
    JOIN entitlements e ON e.application_id = a.id AND e.slug = 'admin'
    WHERE a.slug = 'duro'
    ON CONFLICT (role_id, entitlement_id) DO NOTHING
  `

  yield* sql`
    INSERT INTO group_mappings (oidc_group_name, role_id, application_id)
    SELECT 'lldap_admin', r.id, a.id
    FROM applications a
    JOIN roles r ON r.application_id = a.id AND r.slug = 'admin'
    WHERE a.slug = 'duro'
    ON CONFLICT (oidc_group_name) DO NOTHING
  `
})
