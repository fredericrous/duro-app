// @vitest-environment node
import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { makeTestDbLayer } from "~/lib/db/client.server"
import { PrincipalRepoLive } from "./PrincipalRepo.server"
import { ApplicationRepoLive } from "./ApplicationRepo.server"
import { RbacRepoLive } from "./RbacRepo.server"
import { loadExpiringSoon, loadGlanceStats, loadHygieneExtras, loadRecentActivity } from "./dashboard-stats.server"

// Name maps for the activity feed come from the live repos; everything else
// is raw SQL against the same PGlite database.
const TestLayer = Layer.mergeAll(PrincipalRepoLive, ApplicationRepoLive, RbacRepoLive).pipe(
  Layer.provideMerge(makeTestDbLayer()),
)

const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()

const seed = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email) VALUES
    ('p-user-1', 'user', 'u1', 'User One', 'u1@x.test'),
    ('p-user-2', 'user', 'u2', 'User Two', 'u2@x.test'),
    ('p-svc-1', 'service_account', 's1', 'Svc One', NULL)`

  yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, enabled) VALUES
    ('app-1', 'app-one', 'App One', 'request', true),
    ('app-2', 'app-two', 'App Two', 'open', false)`

  yield* sql`INSERT INTO roles (id, application_id, slug, display_name)
             VALUES ('role-1', 'app-1', 'viewer', 'Viewer')`

  // Grants: one active forever, one expiring in 10 days, one revoked, one expired.
  yield* sql`INSERT INTO grants (id, principal_id, role_id, granted_by, expires_at, revoked_at) VALUES
    ('g-active', 'p-user-1', 'role-1', 'p-user-1', NULL, NULL),
    ('g-expiring', 'p-user-2', 'role-1', 'p-user-1', ${days(10)}, NULL),
    ('g-revoked', 'p-user-2', 'role-1', 'p-user-1', ${days(10)}, now()),
    ('g-expired', 'p-user-2', 'role-1', 'p-user-1', ${days(-1)}, NULL)`

  // API keys: one active (expiring in 5 days), one revoked.
  yield* sql`INSERT INTO api_keys (id, principal_id, key_hash, name, scopes, expires_at, revoked_at) VALUES
    ('k-1', 'p-user-1', 'h1', 'ci-key', '[]', ${days(5)}, NULL),
    ('k-2', 'p-user-1', 'h2', 'old-key', '[]', ${days(5)}, now())`

  // Certificates: one expiring in 40 days (outside horizon), one in 3 days.
  yield* sql`INSERT INTO user_certificates (id, invite_id, user_id, username, email, serial_number, issued_at, expires_at) VALUES
    ('cert-far', 'inv-1', 'u1', 'user-one', 'u1@x.test', 'serial-far', now(), ${days(40)}),
    ('cert-near', 'inv-2', 'u2', 'user-two', 'u2@x.test', 'serial-near', now(), ${days(3)})`

  // Provisioning failures + connector errors.
  yield* sql`INSERT INTO connected_systems (id, application_id, connector_type, config, status, last_error) VALUES
    ('cs-ok', 'app-1', 'http', '{}', 'active', NULL),
    ('cs-bad', 'app-2', 'http', '{}', 'error', 'boom')`
  yield* sql`INSERT INTO provisioning_jobs (id, connected_system_id, grant_id, operation, status) VALUES
    ('job-ok', 'cs-ok', 'g-active', 'provision', 'completed'),
    ('job-bad', 'cs-bad', 'g-active', 'provision', 'failed')`

  // Audit events, oldest first.
  yield* sql`INSERT INTO audit_events (event_type, actor_id, target_type, target_id, created_at) VALUES
    ('auth.login', 'p-user-1', 'principal', 'p-user-1', now() - interval '2 hours'),
    ('grant.created', 'p-user-1', 'principal', 'p-user-2', now() - interval '1 hour')`
})

describe("dashboard-stats", () => {
  it.layer(TestLayer)("aggregates", (it) => {
    it.effect("computes the whole dashboard from seeded data", () =>
      Effect.gen(function* () {
        yield* seed

        const glance = yield* loadGlanceStats
        expect(glance).toEqual({
          people: 2,
          serviceAccounts: 1,
          applicationsEnabled: 1,
          applicationsTotal: 2,
          // g-active + g-expiring (revoked/expired excluded)
          activeGrants: 2,
          activeApiKeys: 1,
        })

        const expiring = yield* loadExpiringSoon()
        // cert (3d) < key (5d) < grant (10d); the 40-day cert is outside the
        // horizon, revoked/expired rows never appear.
        expect(expiring.map((i) => i.kind)).toEqual(["certificate", "apiKey", "grant"])
        expect(expiring[0].label).toBe("user-two")
        expect(expiring[1].label).toContain("ci-key")
        expect(expiring[2].label).toBe("Viewer → User Two")

        const activity = yield* loadRecentActivity()
        expect(activity).toHaveLength(2)
        // Newest first, enriched with display names.
        expect(activity[0].eventType).toBe("grant.created")
        expect(activity[0].actorName).toBe("User One")
        expect(activity[0].targetName).toBe("User Two")
        expect(activity[1].eventType).toBe("auth.login")

        const extras = yield* loadHygieneExtras
        expect(extras).toEqual({ failedProvisioningJobs: 1, connectorsWithErrors: 1 })
      }),
    )

    it.effect("caps and empty-cases behave", () =>
      Effect.gen(function* () {
        // Fresh DB in this layer scope? No — same layer, data persists from the
        // previous test; assert the cap instead with a tight horizon.
        const none = yield* loadExpiringSoon(0)
        expect(none).toEqual([])
        const one = yield* loadExpiringSoon(4, 1)
        expect(one).toHaveLength(1)
        expect(one[0].kind).toBe("certificate")
      }),
    )
  })
})
