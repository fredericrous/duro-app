// @vitest-environment node
import { afterEach, describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { makeTestDbLayer } from "~/lib/db/client.server"
import {
  AuditService,
  AuditServiceLive,
  registerAuditSink,
  _resetAuditSinksForTesting,
  type AuditEventInput,
  type AuditSink,
} from "./AuditService.server"

const TestLayer = AuditServiceLive.pipe(Layer.provideMerge(makeTestDbLayer()))

afterEach(() => {
  // Sinks are process-local; clean up so cross-test bleed doesn't happen.
  _resetAuditSinksForTesting()
})

describe("AuditService sinks", () => {
  it.layer(TestLayer)("emit fires registered sinks with the event payload", (it) => {
    it.effect("happy path: insert + fan-out", () =>
      Effect.gen(function* () {
        const seen: AuditEventInput[] = []
        const sink: AuditSink = (event) =>
          Effect.sync(() => {
            seen.push(event)
          })
        registerAuditSink(sink)

        const audit = yield* AuditService
        // Skip actorId — it FKs to principals(id); using one would require seed.
        yield* audit.emit({ eventType: "test.fired", targetType: "t", targetId: "tid" })

        expect(seen).toHaveLength(1)
        expect(seen[0].eventType).toBe("test.fired")
        expect(seen[0].targetId).toBe("tid")
      }),
    )
  })

  it.layer(TestLayer)("a sink defect does not fail emit (isolation)", (it) => {
    it.effect("broken sink: emit still resolves and the DB row is written", () =>
      Effect.gen(function* () {
        const goodCalls: AuditEventInput[] = []
        registerAuditSink(() =>
          Effect.sync(() => {
            throw new Error("boom — this sink is broken")
          }),
        )
        registerAuditSink((event) =>
          Effect.sync(() => {
            goodCalls.push(event)
          }),
        )

        const audit = yield* AuditService
        const sql = yield* SqlClient.SqlClient

        // Should not throw — defects are swallowed.
        yield* audit.emit({ eventType: "test.isolation", targetType: "t", targetId: "iso-1" })

        // Healthy sink still fired.
        expect(goodCalls).toHaveLength(1)

        // DB write happened.
        const rows =
          yield* sql`SELECT count(*)::int AS n FROM audit_events WHERE target_id = 'iso-1' AND event_type = 'test.isolation'`
        expect((rows[0] as { n: number }).n).toBe(1)
      }),
    )
  })

  it.layer(TestLayer)("unsubscribe removes the sink", (it) => {
    it.effect("after unsubscribe, sink no longer receives events", () =>
      Effect.gen(function* () {
        const seen: AuditEventInput[] = []
        const unsub = registerAuditSink((event) =>
          Effect.sync(() => {
            seen.push(event)
          }),
        )

        const audit = yield* AuditService
        yield* audit.emit({ eventType: "test.before", targetId: "u-1" })

        unsub()
        yield* audit.emit({ eventType: "test.after", targetId: "u-2" })

        expect(seen.map((e) => e.eventType)).toEqual(["test.before"])
      }),
    )
  })
})
