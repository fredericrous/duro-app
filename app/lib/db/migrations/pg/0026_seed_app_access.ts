import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

/**
 * Seed governance app *visibility* so the home app grid works under
 * AUTH_MODE=governance.
 *
 * Home computes visible apps as "apps where the AuthzEngine allows
 * action='access'". Before this, no app had an `access` entitlement and no one
 * had access grants, so the grid was empty. This replicates the point-in-time
 * `apps.json` group→app visibility into governance:
 *   - lldap_admin → all apps, family → 6, friends → 4 (subset).
 *
 * Modelling choices:
 *   - Give every app an `access` entitlement (the slug the engine matches).
 *   - **Admins**: bundle every app's `access` entitlement into the EXISTING
 *     `duro` admin role (from 0025). An engine grant expands a role's
 *     entitlements per-app at check time, so an lldap_admin member's existing
 *     auto-synced admin grant now also confers app access — no re-login and no
 *     disruption to the live admin path.
 *   - **family / friends**: greenfield (no such users yet) — model them as
 *     group principals with direct `access` entitlement grants, mapped from the
 *     OIDC group. On login GroupSyncService adds the user to the group principal.
 *
 * Note: `social-planner` is in apps.json but not (yet) a registered application,
 * so it's skipped here; add it once it's synced. This is a point-in-time
 * snapshot of apps.json — governance is the source of truth going forward.
 *
 * Idempotent via unique constraints / NOT EXISTS guards.
 */
const ALL_APPS = [
  "nextcloud",
  "plex",
  "immich",
  "stremio",
  "kyoo",
  "seerr",
  "n8n",
  "kavita",
  "navidrome",
  "sonarr",
  "radarr",
  "prowlarr",
  "qbittorrent",
  "openclaw",
  "openwebui",
  "paperless",
  "paperless-gpt",
  "code-server",
  "gitea",
  "authelia",
  "grafana",
  "cluster-vision",
  "lldap",
  "ddns-updater",
  "kb-vision",
  "flux",
  "stalwart",
]
const FAMILY = ["nextcloud", "plex", "immich", "stremio", "kyoo", "openwebui"]
const FRIENDS = ["plex", "stremio", "kyoo", "openwebui"]

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  // 1. An `access` entitlement on every app.
  yield* sql`
    INSERT INTO entitlements (application_id, slug, display_name)
    SELECT id, 'access', 'Access'
    FROM applications WHERE slug = ANY(${ALL_APPS})
    ON CONFLICT (application_id, slug) DO NOTHING
  `

  // 2. Admins see every app: bundle every access entitlement into the duro
  //    admin role (existing lldap_admin → admin-role mapping then covers it).
  yield* sql`
    INSERT INTO role_entitlements (role_id, entitlement_id)
    SELECT ar.id, e.id
    FROM entitlements e
    JOIN applications a ON a.id = e.application_id
    JOIN roles ar ON ar.slug = 'admin'
    JOIN applications da ON da.id = ar.application_id AND da.slug = 'duro'
    WHERE e.slug = 'access' AND a.slug = ANY(${ALL_APPS})
    ON CONFLICT (role_id, entitlement_id) DO NOTHING
  `

  // 3. Group principals for family / friends.
  yield* sql`
    INSERT INTO principals (id, principal_type, display_name)
    VALUES ('grp-family', 'group', 'Family'), ('grp-friends', 'group', 'Friends')
    ON CONFLICT (id) DO NOTHING
  `

  // 4. Access grants for the group principals (entitlement grants).
  yield* sql`
    INSERT INTO grants (principal_id, entitlement_id, granted_by, reason)
    SELECT 'grp-family', e.id, 'grp-family', 'seed: apps.json family visibility'
    FROM entitlements e
    JOIN applications a ON a.id = e.application_id
    WHERE e.slug = 'access' AND a.slug = ANY(${FAMILY})
      AND NOT EXISTS (
        SELECT 1 FROM grants g WHERE g.principal_id = 'grp-family' AND g.entitlement_id = e.id AND g.revoked_at IS NULL
      )
  `
  yield* sql`
    INSERT INTO grants (principal_id, entitlement_id, granted_by, reason)
    SELECT 'grp-friends', e.id, 'grp-friends', 'seed: apps.json friends visibility'
    FROM entitlements e
    JOIN applications a ON a.id = e.application_id
    WHERE e.slug = 'access' AND a.slug = ANY(${FRIENDS})
      AND NOT EXISTS (
        SELECT 1 FROM grants g WHERE g.principal_id = 'grp-friends' AND g.entitlement_id = e.id AND g.revoked_at IS NULL
      )
  `

  // 5. Map the OIDC groups to the group principals (membership synced on login).
  yield* sql`
    INSERT INTO group_mappings (oidc_group_name, principal_group_id)
    VALUES ('family', 'grp-family'), ('friends', 'grp-friends')
    ON CONFLICT (oidc_group_name) DO NOTHING
  `
})
