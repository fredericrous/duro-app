// @vitest-environment node
import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { makeTestDbLayer } from "~/lib/db/client.server"
import { PrincipalRepoLive } from "./PrincipalRepo.server"
import { GroupSyncServiceLive } from "./GroupSyncService.server"
import { AuditServiceLive } from "./AuditService.server"
import { syncLogin } from "./login-sync.server"

// Live audit service on purpose — the whole point is asserting the
// auth.login row lands in audit_events (TestAppLayer's AuditServiceDev
// is a no-op).
const TestLayer = Layer.mergeAll(PrincipalRepoLive, GroupSyncServiceLive, AuditServiceLive).pipe(
  Layer.provideMerge(makeTestDbLayer()),
)

describe("syncLogin", () => {
  it.layer(TestLayer)("records a sign-in", (it) => {
    it.effect("upserts the principal and writes an auth.login audit event", () =>
      Effect.gen(function* () {
        const principal = yield* syncLogin(
          { sub: "oidc-sub-1", name: "Test User", email: "test@x.test", groups: [] },
          "203.0.113.7",
        )
        expect(principal.externalId).toBe("oidc-sub-1")

        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql`SELECT * FROM audit_events WHERE event_type = 'auth.login'`
        expect(rows).toHaveLength(1)
        const row = rows[0] as { actorId?: string; actor_id?: string; ipAddress?: string; ip_address?: string }
        expect(row.actorId ?? row.actor_id).toBe(principal.id)
        expect(row.ipAddress ?? row.ip_address).toBe("203.0.113.7")
      }),
    )

    it.effect("every sign-in appends a new event (no dedupe)", () =>
      Effect.gen(function* () {
        yield* syncLogin({ sub: "oidc-sub-2", name: "Repeat User", email: "r@x.test", groups: [] })
        yield* syncLogin({ sub: "oidc-sub-2", name: "Repeat User", email: "r@x.test", groups: [] })
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql`
          SELECT ae.* FROM audit_events ae
          JOIN principals p ON p.id = ae.actor_id
          WHERE ae.event_type = 'auth.login' AND p.external_id = 'oidc-sub-2'`
        expect(rows).toHaveLength(2)
      }),
    )
  })
})
