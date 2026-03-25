import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  // Resources — hierarchical protected objects inside an application
  yield* sql`
    CREATE TABLE IF NOT EXISTS resources (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
      application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      parent_resource_id TEXT REFERENCES resources(id) ON DELETE CASCADE,
      resource_type TEXT NOT NULL,
      external_id TEXT,
      display_name TEXT NOT NULL,
      path TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  yield* sql`CREATE INDEX IF NOT EXISTS idx_resources_app ON resources(application_id)`
  yield* sql`CREATE INDEX IF NOT EXISTS idx_resources_parent ON resources(parent_resource_id)`
  yield* sql`CREATE INDEX IF NOT EXISTS idx_resources_path ON resources(path)`

  // Roles — named bundles of entitlements, per-application
  yield* sql`
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
      application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT,
      max_duration_hours INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(application_id, slug)
    )
  `

  // Entitlements — atomic permissions, per-application
  yield* sql`
    CREATE TABLE IF NOT EXISTS entitlements (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
      application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(application_id, slug)
    )
  `

  // Role-entitlement mapping
  yield* sql`
    CREATE TABLE IF NOT EXISTS role_entitlements (
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      entitlement_id TEXT NOT NULL REFERENCES entitlements(id) ON DELETE CASCADE,
      PRIMARY KEY (role_id, entitlement_id)
    )
  `

  // Grants — principal gets role XOR entitlement, optionally scoped to resource
  yield* sql`
    CREATE TABLE IF NOT EXISTS grants (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
      principal_id TEXT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
      role_id TEXT REFERENCES roles(id) ON DELETE CASCADE,
      entitlement_id TEXT REFERENCES entitlements(id) ON DELETE CASCADE,
      resource_id TEXT REFERENCES resources(id) ON DELETE SET NULL,
      granted_by TEXT NOT NULL REFERENCES principals(id),
      reason TEXT,
      expires_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      revoked_by TEXT REFERENCES principals(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (
        (role_id IS NOT NULL AND entitlement_id IS NULL) OR
        (role_id IS NULL AND entitlement_id IS NOT NULL)
      )
    )
  `
  yield* sql`CREATE INDEX IF NOT EXISTS idx_grants_principal ON grants(principal_id) WHERE revoked_at IS NULL`
  yield* sql`CREATE INDEX IF NOT EXISTS idx_grants_role ON grants(role_id) WHERE revoked_at IS NULL`
  yield* sql`CREATE INDEX IF NOT EXISTS idx_grants_entitlement ON grants(entitlement_id) WHERE revoked_at IS NULL`
  yield* sql`CREATE INDEX IF NOT EXISTS idx_grants_resource ON grants(resource_id) WHERE revoked_at IS NULL`

  // Add FK constraint on group_mappings.role_id now that roles table exists
  // PGlite may not support ADD CONSTRAINT IF NOT EXISTS, so we catch errors
  yield* sql`
    DO $$ BEGIN
      ALTER TABLE group_mappings ADD CONSTRAINT fk_group_mappings_role FOREIGN KEY (role_id) REFERENCES roles(id);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `.pipe(Effect.catchAll(() => Effect.void))
})
