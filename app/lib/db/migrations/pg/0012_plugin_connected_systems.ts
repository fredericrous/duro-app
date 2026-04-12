import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`ALTER TABLE connected_systems ADD COLUMN IF NOT EXISTS plugin_slug TEXT`
  yield* sql`ALTER TABLE connected_systems ADD COLUMN IF NOT EXISTS plugin_version TEXT`

  // Widen connector_type CHECK to include 'plugin'. Drop + re-add because
  // ALTER CONSTRAINT doesn't support CHECK modification directly.
  yield* sql`ALTER TABLE connected_systems DROP CONSTRAINT IF EXISTS connected_systems_connector_type_check`
  yield* sql`
    ALTER TABLE connected_systems ADD CONSTRAINT connected_systems_connector_type_check
    CHECK (connector_type IN ('http','ldap','scim','webhook','plugin'))
  `

  // Enforce plugin_slug presence when connector_type = 'plugin'
  yield* sql`
    ALTER TABLE connected_systems ADD CONSTRAINT connected_systems_plugin_consistency
    CHECK (
      (connector_type = 'plugin' AND plugin_slug IS NOT NULL AND plugin_version IS NOT NULL)
      OR (connector_type <> 'plugin')
    )
  `

  // Data migration: convert existing phase 1 LDAP rows into plugin rows.
  // The config shape changes from { groupPrefix: "nextcloud" } to
  // { viewerGroup: "nextcloud-user", editorGroup: "nextcloud-user", adminGroup: "nextcloud-admin" }.
  yield* sql`
    UPDATE connected_systems
    SET
      connector_type = 'plugin',
      plugin_slug = 'lldap-group-membership',
      plugin_version = '1.0.0',
      config = jsonb_build_object(
        'viewerGroup', (config->>'groupPrefix') || '-user',
        'editorGroup', (config->>'groupPrefix') || '-user',
        'adminGroup',  (config->>'groupPrefix') || '-admin'
      )
    WHERE connector_type = 'ldap'
      AND config ? 'groupPrefix'
  `

  // Immich quirk: phase 1 mapped admin → immich-user (not immich-admin)
  // because Immich has no group-based admin mechanism. Fix up the data
  // migration output so the admin group stays -user for Immich installs.
  yield* sql`
    UPDATE connected_systems
    SET config = jsonb_set(config, '{adminGroup}', to_jsonb((config->>'viewerGroup')::text))
    WHERE plugin_slug = 'lldap-group-membership'
      AND application_id IN (
        SELECT id FROM applications WHERE slug = 'immich'
      )
  `
})
