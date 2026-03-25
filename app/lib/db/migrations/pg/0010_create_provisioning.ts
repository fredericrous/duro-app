import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  // Connected systems — external systems that duro can provision access to
  yield* sql`
    CREATE TABLE IF NOT EXISTS connected_systems (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
      application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      connector_type TEXT NOT NULL CHECK (connector_type IN ('http','ldap','scim','webhook')),
      config JSONB NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','error')),
      last_sync_at TIMESTAMPTZ,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `

  // Connector mappings — map local roles/entitlements to external system identifiers
  yield* sql`
    CREATE TABLE IF NOT EXISTS connector_mappings (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
      connected_system_id TEXT NOT NULL REFERENCES connected_systems(id) ON DELETE CASCADE,
      local_role_id TEXT REFERENCES roles(id) ON DELETE CASCADE,
      local_entitlement_id TEXT REFERENCES entitlements(id) ON DELETE CASCADE,
      external_role_identifier TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'push' CHECK (direction IN ('push','pull','bidirectional')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (
        (local_role_id IS NOT NULL AND local_entitlement_id IS NULL) OR
        (local_role_id IS NULL AND local_entitlement_id IS NOT NULL)
      )
    )
  `

  // Provisioning jobs
  yield* sql`
    CREATE TABLE IF NOT EXISTS provisioning_jobs (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
      connected_system_id TEXT NOT NULL REFERENCES connected_systems(id) ON DELETE CASCADE,
      grant_id TEXT NOT NULL REFERENCES grants(id),
      operation TEXT NOT NULL CHECK (operation IN ('provision','deprovision')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  yield* sql`CREATE INDEX IF NOT EXISTS idx_provisioning_jobs_status ON provisioning_jobs(status) WHERE status IN ('pending','running')`
})
