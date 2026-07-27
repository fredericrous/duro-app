// @vitest-environment node
import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { makeTestDbLayer } from "~/lib/db/client.server"
import { AuditService, AuditServiceLive, type AuditEventInput, type AuditSink } from "./AuditService.server"

// Sinks live in a Ref created per layer build — each it.layer() gets a fresh
// registry, so there is no cross-test bleed and no reset hook.
const TestLayer = AuditServiceLive.pipe(Layer.provideMerge(makeTestDbLayer()))

describe("AuditService sinks", () => {
  it.layer(TestLayer)("emit fires registered sinks with the event payload", (it) => {
    it.effect("happy path: insert + fan-out", () =>
      Effect.gen(function* () {
        const seen: AuditEventInput[] = []
        const sink: AuditSink = (event) =>
          Effect.sync(() => {
            seen.push(event)
          })
        const audit = yield* AuditService
        yield* audit.subscribe(sink)
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
        const audit = yield* AuditService
        const sql = yield* SqlClient.SqlClient
        yield* audit.subscribe(() =>
          Effect.sync(() => {
            throw new Error("boom — this sink is broken")
          }),
        )
        yield* audit.subscribe((event) =>
          Effect.sync(() => {
            goodCalls.push(event)
          }),
        )

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
        const audit = yield* AuditService
        const unsub = yield* audit.subscribe((event) =>
          Effect.sync(() => {
            seen.push(event)
          }),
        )
        yield* audit.emit({ eventType: "test.before", targetId: "u-1" })

        unsub()
        yield* audit.emit({ eventType: "test.after", targetId: "u-2" })

        expect(seen.map((e) => e.eventType)).toEqual(["test.before"])
      }),
    )
  })
})
