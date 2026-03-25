import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  // Approval policies
  yield* sql`
    CREATE TABLE IF NOT EXISTS approval_policies (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
      application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      scope_type TEXT NOT NULL CHECK (scope_type IN ('application','role','entitlement','resource')),
      scope_id TEXT,
      mode TEXT NOT NULL DEFAULT 'one_of' CHECK (mode IN ('none','one_of','all_of')),
      rules JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  yield* sql`CREATE INDEX IF NOT EXISTS idx_approval_policies_app ON approval_policies(application_id, scope_type)`

  // Access requests
  yield* sql`
    CREATE TABLE IF NOT EXISTS access_requests (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
      requester_id TEXT NOT NULL REFERENCES principals(id),
      application_id TEXT NOT NULL REFERENCES applications(id),
      role_id TEXT REFERENCES roles(id),
      entitlement_id TEXT REFERENCES entitlements(id),
      resource_id TEXT REFERENCES resources(id),
      justification TEXT,
      requested_duration_hours INTEGER,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled','expired')),
      resolved_at TIMESTAMPTZ,
      grant_id TEXT REFERENCES grants(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ,
      CHECK (
        (role_id IS NOT NULL AND entitlement_id IS NULL) OR
        (role_id IS NULL AND entitlement_id IS NOT NULL)
      )
    )
  `
  yield* sql`CREATE INDEX IF NOT EXISTS idx_access_requests_requester ON access_requests(requester_id, status)`
  yield* sql`CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests(status) WHERE status = 'pending'`

  // Request approvals
  yield* sql`
    CREATE TABLE IF NOT EXISTS request_approvals (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
      request_id TEXT NOT NULL REFERENCES access_requests(id) ON DELETE CASCADE,
      approver_id TEXT NOT NULL REFERENCES principals(id),
      decision TEXT CHECK (decision IN ('approved','rejected')),
      comment TEXT,
      decided_at TIMESTAMPTZ
    )
  `
  yield* sql`CREATE INDEX IF NOT EXISTS idx_request_approvals_request ON request_approvals(request_id)`

  // Access invitations (governance invitations, distinct from onboarding invites)
  yield* sql`
    CREATE TABLE IF NOT EXISTS access_invitations (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
      application_id TEXT NOT NULL REFERENCES applications(id),
      role_id TEXT REFERENCES roles(id),
      entitlement_id TEXT REFERENCES entitlements(id),
      resource_id TEXT REFERENCES resources(id),
      invited_principal_id TEXT NOT NULL REFERENCES principals(id),
      invited_by TEXT NOT NULL REFERENCES principals(id),
      message TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','expired')),
      grant_id TEXT REFERENCES grants(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ,
      resolved_at TIMESTAMPTZ
    )
  `
  yield* sql`CREATE INDEX IF NOT EXISTS idx_access_invitations_principal ON access_invitations(invited_principal_id, status)`

  // Audit events
  yield* sql`
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type TEXT NOT NULL,
      actor_id TEXT REFERENCES principals(id),
      target_type TEXT,
      target_id TEXT,
      application_id TEXT REFERENCES applications(id),
      metadata JSONB NOT NULL DEFAULT '{}',
      ip_address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  yield* sql`CREATE INDEX IF NOT EXISTS idx_audit_events_type ON audit_events(event_type, created_at DESC)`
  yield* sql`CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON audit_events(actor_id, created_at DESC)`
  yield* sql`CREATE INDEX IF NOT EXISTS idx_audit_events_app ON audit_events(application_id, created_at DESC)`
  yield* sql`CREATE INDEX IF NOT EXISTS idx_audit_events_target ON audit_events(target_type, target_id)`

  // API keys
  yield* sql`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
      principal_id TEXT NOT NULL REFERENCES principals(id),
      key_hash TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      scopes JSONB NOT NULL DEFAULT '["*"]',
      expires_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  yield* sql`CREATE INDEX IF NOT EXISTS idx_api_keys_principal ON api_keys(principal_id)`
  yield* sql`CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash) WHERE revoked_at IS NULL`
})
