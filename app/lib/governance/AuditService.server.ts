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
        ),

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
              WHERE (${eventType} IS NULL OR event_type = ${eventType})
                AND (${actorId} IS NULL OR actor_id = ${actorId})
                AND (${applicationId} IS NULL OR application_id = ${applicationId})
                AND (${targetType} IS NULL OR target_type = ${targetType})
                AND (${targetId} IS NULL OR target_id = ${targetId})
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
    }).pipe(Effect.asVoid),

  query: (_filters) => Effect.log("[AuditService/dev] query").pipe(Effect.as([] as AuditEvent[])),
})
