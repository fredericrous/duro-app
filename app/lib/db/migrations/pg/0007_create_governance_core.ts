import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  // Principals — canonical identity anchor for governance
  yield* sql`
    CREATE TABLE IF NOT EXISTS principals (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
      principal_type TEXT NOT NULL CHECK (principal_type IN ('user','group','service_account','device')),
      external_id TEXT,
      display_name TEXT NOT NULL,
      email TEXT,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  yield* sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_principals_external_id ON principals(external_id) WHERE external_id IS NOT NULL`
  yield* sql`CREATE INDEX IF NOT EXISTS idx_principals_type ON principals(principal_type)`

  // Group memberships — single-hop only, both FKs reference principals
  yield* sql`
    CREATE TABLE IF NOT EXISTS group_memberships (
      group_id TEXT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
      member_id TEXT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (group_id, member_id)
    )
  `
  yield* sql`CREATE INDEX IF NOT EXISTS idx_group_memberships_member ON group_memberships(member_id)`

  // Applications — things people request access to
  yield* sql`
    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
      slug TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      description TEXT,
      access_mode TEXT NOT NULL DEFAULT 'request' CHECK (access_mode IN ('open','request','invite_only')),
      owner_id TEXT REFERENCES principals(id),
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `

  // Group mappings — deterministic OIDC group → governance mapping
  // NOTE: role_id FK is deferred because roles table is created in migration 0008.
  // We create the table here without role_id FK and add it via ALTER in 0008.
  yield* sql`
    CREATE TABLE IF NOT EXISTS group_mappings (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
      oidc_group_name TEXT NOT NULL UNIQUE,
      principal_group_id TEXT REFERENCES principals(id),
      role_id TEXT,
      application_id TEXT REFERENCES applications(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (
        (principal_group_id IS NOT NULL AND role_id IS NULL) OR
        (principal_group_id IS NULL AND role_id IS NOT NULL AND application_id IS NOT NULL)
      )
    )
  `
})
