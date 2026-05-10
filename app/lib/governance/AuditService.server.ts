import { Context, Effect, Data, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import * as SqlError from "@effect/sql/SqlError"
import { MigrationsRan } from "~/lib/db/client.server"
import { decodeAuditEvent, type AuditEvent } from "./types"

export class AuditError extends Data.TaggedError("AuditError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

const withErr = <A>(effect: Effect.Effect<A, SqlError.SqlError>, message: string) =>
  effect.pipe(Effect.mapError((e) => new AuditError({ message, cause: e })))

// ---------------------------------------------------------------------------
// Subscriber primitive
//
// Sinks are best-effort side-effect handlers that fan out from `emit` AFTER
// the DB write succeeds. The DB row is the source of truth; sinks exist for
// notifications (email, Slack, SSE-push to admin clients), metrics, etc.
//
// Errors in a sink are swallowed (logged) — one slow or broken subscriber
// must not poison the audit emit path. The registry is process-local; for a
// multi-process deployment, swap to LISTEN/NOTIFY or a real pub-sub later.
// ---------------------------------------------------------------------------

export interface AuditEventInput {
  readonly eventType: string
  readonly actorId?: string
  readonly targetType?: string
  readonly targetId?: string
  readonly applicationId?: string
  readonly metadata?: Record<string, unknown>
  readonly ipAddress?: string
}

export type AuditSink = (event: AuditEventInput) => Effect.Effect<void, never>

const sinks: AuditSink[] = []

/** Register a sink. Returns an unsubscribe function. */
export function registerAuditSink(sink: AuditSink): () => void {
  sinks.push(sink)
  return () => {
    const i = sinks.indexOf(sink)
    if (i >= 0) sinks.splice(i, 1)
  }
}

/** Test-only escape hatch — clears the registry between tests. */
export function _resetAuditSinksForTesting(): void {
  sinks.length = 0
}

const fanoutToSinks = (event: AuditEventInput): Effect.Effect<void, never> =>
  Effect.forEach(
    sinks,
    (sink) =>
      sink(event).pipe(
        // Sinks are typed as Effect<void, never>, but a misbehaving sink could
        // still throw (defects). Swallow defects so emit never fails.
        Effect.catchAllDefect((d) =>
          Effect.logWarning("audit sink defect", { error: String(d), eventType: event.eventType }),
        ),
      ),
    { concurrency: "unbounded" },
  ).pipe(Effect.asVoid)

export class AuditService extends Context.Tag("AuditService")<
  AuditService,
  {
    readonly emit: (event: {
      eventType: string
      actorId?: string
      targetType?: string
      targetId?: string
      applicationId?: string
      metadata?: Record<string, unknown>
      ipAddress?: string
    }) => Effect.Effect<void, AuditError>
    readonly query: (filters: {
      eventType?: string
      actorId?: string
      applicationId?: string
      targetType?: string
      targetId?: string
      limit?: number
      offset?: number
    }) => Effect.Effect<AuditEvent[], AuditError>
  }
>() {}

export const AuditServiceLive = Layer.effect(
  AuditService,
  Effect.gen(function* () {
    yield* MigrationsRan
    const sql = yield* SqlClient.SqlClient

    return {
      emit: (event) =>
        withErr(
          sql`INSERT INTO audit_events (event_type, actor_id, target_type, target_id, application_id, metadata, ip_address)
              VALUES (${event.eventType}, ${event.actorId ?? null}, ${event.targetType ?? null}, ${event.targetId ?? null}, ${event.applicationId ?? null}, ${event.metadata ? JSON.stringify(event.metadata) : "{}"}, ${event.ipAddress ?? null})`.pipe(
            Effect.asVoid,
          ),
          "Failed to emit audit event",
        ).pipe(Effect.zipLeft(fanoutToSinks(event))),

      query: (filters) => {
        const eventType = filters.eventType ?? null
        const actorId = filters.actorId ?? null
        const applicationId = filters.applicationId ?? null
        const targetType = filters.targetType ?? null
        const targetId = filters.targetId ?? null
        const limit = filters.limit ?? 100
        const offset = filters.offset ?? 0

        return withErr(
          sql`SELECT * FROM audit_events
              WHERE (${eventType}::text IS NULL OR event_type = ${eventType}::text)
                AND (${actorId}::text IS NULL OR actor_id = ${actorId}::text)
                AND (${applicationId}::text IS NULL OR application_id = ${applicationId}::text)
                AND (${targetType}::text IS NULL OR target_type = ${targetType}::text)
                AND (${targetId}::text IS NULL OR target_id = ${targetId}::text)
              ORDER BY created_at DESC
              LIMIT ${limit} OFFSET ${offset}`.pipe(Effect.map((rows) => rows.map((r) => decodeAuditEvent(r)))),
          "Failed to query audit events",
        )
      },
    }
  }),
)

export const AuditServiceDev = Layer.succeed(AuditService, {
  emit: (event) =>
    Effect.log(`[AuditService/dev] emit ${event.eventType}`, {
      actorId: event.actorId,
      targetType: event.targetType,
      targetId: event.targetId,
    })
      .pipe(Effect.asVoid)
      .pipe(Effect.zipLeft(fanoutToSinks(event))),

  query: (_filters) => Effect.log("[AuditService/dev] query").pipe(Effect.as([] as AuditEvent[])),
})
