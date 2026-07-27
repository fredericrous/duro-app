// @vitest-environment node
import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { makeTestDbLayer } from "~/lib/db/client.server"
import { PrincipalRepoLive } from "~/lib/governance/PrincipalRepo.server"
import { ApplicationRepoLive } from "~/lib/governance/ApplicationRepo.server"
import { RbacRepoLive } from "~/lib/governance/RbacRepo.server"
import { loadUserAccess, loadUserActivity } from "./user-activity.server"

const TestLayer = Layer.mergeAll(PrincipalRepoLive, ApplicationRepoLive, RbacRepoLive).pipe(
  Layer.provideMerge(makeTestDbLayer()),
)

const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()

const seed = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email) VALUES
    ('p-me', 'user', 'me', 'Me', 'me@x.test'),
    ('p-admin', 'user', 'admin', 'Admin', 'admin@x.test'),
    ('p-other', 'user', 'other', 'Other', 'other@x.test')`

  yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, enabled)
             VALUES ('app-1', 'app-one', 'App One', 'request', true)`
  yield* sql`INSERT INTO roles (id, application_id, slug, display_name)
             VALUES ('role-1', 'app-1', 'viewer', 'Viewer')`

  // Grants: mine active w/ reason+expiry, mine revoked, someone else's.
  yield* sql`INSERT INTO grants (id, principal_id, role_id, granted_by, reason, expires_at, revoked_at) VALUES
    ('g-mine', 'p-me', 'role-1', 'p-admin', 'onboarding', ${days(30)}, NULL),
    ('g-mine-revoked', 'p-me', 'role-1', 'p-admin', NULL, NULL, now()),
    ('g-other', 'p-other', 'role-1', 'p-admin', NULL, NULL, NULL)`

  // Audit: my own login, an admin action TARGETING me, a grant event carrying
  // my principal id only in metadata, and an unrelated event.
  yield* sql`INSERT INTO audit_events (event_type, actor_id, target_type, target_id, metadata, created_at) VALUES
    ('auth.login', 'p-me', 'principal', 'p-me', '{}', now() - interval '3 hours'),
    ('user.revoked', 'p-admin', 'principal', 'p-me', '{}', now() - interval '2 hours'),
    ('grant.created', 'p-admin', 'grant', 'g-mine', '{"principalId":"p-me","roleId":"role-1"}', now() - interval '1 hour'),
    ('auth.login', 'p-other', 'principal', 'p-other', '{}', now())`
})

describe("user-activity", () => {
  it.layer(TestLayer)("queries", (it) => {
    it.effect("returns my actions, actions targeting me, and metadata matches — newest first", () =>
      Effect.gen(function* () {
        yield* seed
        const events = yield* loadUserActivity("p-me")
        expect(events.map((e) => e.eventType)).toEqual(["grant.created", "user.revoked", "auth.login"])
        // Enriched: the grant event names role + recipient from metadata.
        expect(events[0].actorName).toBe("Admin")
        expect(events[0].targetName).toBe("Viewer → Me")
        // The unrelated user's login is not included.
        expect(events.some((e) => e.actorName === "Other")).toBe(false)
      }),
    )

    it.effect("lists only my active grants with app, reason and expiry", () =>
      Effect.gen(function* () {
        const access = yield* loadUserAccess("p-me")
        expect(access).toHaveLength(1)
        expect(access[0]).toMatchObject({
          what: "Viewer",
          app: "App One",
          reason: "onboarding",
        })
        expect(access[0].expiresAt).not.toBeNull()
      }),
    )
  })
})
