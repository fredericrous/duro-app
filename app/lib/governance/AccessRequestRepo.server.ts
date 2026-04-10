import { Context, Effect, Data, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import * as SqlError from "@effect/sql/SqlError"
import { MigrationsRan } from "~/lib/db/client.server"
import {
  decodeAccessRequest,
  decodeRequestApproval,
  decodeApprovalPolicy,
  type AccessRequest,
  type RequestApproval,
  type ApprovalPolicy,
} from "./types"

export class AccessRequestRepoError extends Data.TaggedError("AccessRequestRepoError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

const withErr = <A>(effect: Effect.Effect<A, SqlError.SqlError>, message: string) =>
  effect.pipe(Effect.mapError((e) => new AccessRequestRepoError({ message, cause: e })))

export class AccessRequestRepo extends Context.Tag("AccessRequestRepo")<
  AccessRequestRepo,
  {
    readonly create: (input: {
      requesterId: string
      applicationId: string
      roleId?: string
      entitlementId?: string
      resourceId?: string
      justification?: string
      requestedDurationHours?: number
    }) => Effect.Effect<AccessRequest, AccessRequestRepoError>
    readonly findById: (id: string) => Effect.Effect<AccessRequest | null, AccessRequestRepoError>
    readonly listPending: (applicationId?: string) => Effect.Effect<AccessRequest[], AccessRequestRepoError>
    readonly listForRequester: (requesterId: string) => Effect.Effect<AccessRequest[], AccessRequestRepoError>
    readonly listAll: (filters?: {
      status?: string
      applicationId?: string
      limit?: number
      offset?: number
    }) => Effect.Effect<AccessRequest[], AccessRequestRepoError>
    readonly recordDecision: (
      requestId: string,
      approverId: string,
      decision: string,
      comment?: string,
    ) => Effect.Effect<void, AccessRequestRepoError>
    readonly getApprovals: (requestId: string) => Effect.Effect<RequestApproval[], AccessRequestRepoError>
    readonly createApprovalRecords: (
      requestId: string,
      approverIds: string[],
    ) => Effect.Effect<void, AccessRequestRepoError>
    readonly updateStatus: (requestId: string, status: string) => Effect.Effect<void, AccessRequestRepoError>
    readonly linkGrant: (requestId: string, grantId: string) => Effect.Effect<void, AccessRequestRepoError>
    readonly findApprovalPolicy: (
      applicationId: string,
      roleId?: string,
      entitlementId?: string,
    ) => Effect.Effect<ApprovalPolicy | null, AccessRequestRepoError>
  }
>() {}

export const AccessRequestRepoLive = Layer.effect(
  AccessRequestRepo,
  Effect.gen(function* () {
    yield* MigrationsRan
    const sql = yield* SqlClient.SqlClient

    return {
      create: (input) =>
        withErr(
          sql`INSERT INTO access_requests (requester_id, application_id, role_id, entitlement_id, resource_id, justification, requested_duration_hours)
              VALUES (${input.requesterId}, ${input.applicationId}, ${input.roleId ?? null}, ${input.entitlementId ?? null}, ${input.resourceId ?? null}, ${input.justification ?? null}, ${input.requestedDurationHours ?? null})
              RETURNING *`.pipe(Effect.map((rows) => decodeAccessRequest(rows[0]) as AccessRequest)),
          "Failed to create access request",
        ),

      findById: (id) =>
        withErr(
          sql`SELECT * FROM access_requests WHERE id = ${id}`.pipe(
            Effect.map((rows) => (rows.length > 0 ? (decodeAccessRequest(rows[0]) as AccessRequest) : null)),
          ),
          "Failed to find access request",
        ),

      listPending: (applicationId) =>
        withErr(
          sql`SELECT * FROM access_requests
              WHERE status = 'pending'
                AND (${applicationId ?? null}::text IS NULL OR application_id = ${applicationId ?? null})
              ORDER BY created_at ASC`.pipe(
            Effect.map((rows) => rows.map((r) => decodeAccessRequest(r) as AccessRequest)),
          ),
          "Failed to list pending access requests",
        ),

      listForRequester: (requesterId) =>
        withErr(
          sql`SELECT * FROM access_requests
              WHERE requester_id = ${requesterId}
              ORDER BY created_at DESC`.pipe(
            Effect.map((rows) => rows.map((r) => decodeAccessRequest(r) as AccessRequest)),
          ),
          "Failed to list access requests for requester",
        ),

      listAll: (filters) =>
        withErr(
          sql`SELECT * FROM access_requests
              WHERE (${filters?.status ?? null}::text IS NULL OR status = ${filters?.status ?? null})
                AND (${filters?.applicationId ?? null}::text IS NULL OR application_id = ${filters?.applicationId ?? null})
              ORDER BY created_at DESC
              LIMIT ${filters?.limit ?? 100}
              OFFSET ${filters?.offset ?? 0}`.pipe(
            Effect.map((rows) => rows.map((r) => decodeAccessRequest(r) as AccessRequest)),
          ),
          "Failed to list access requests",
        ),

      recordDecision: (requestId, approverId, decision, comment) =>
        withErr(
          sql`UPDATE request_approvals
              SET decision = ${decision}, comment = ${comment ?? null}, decided_at = NOW()
              WHERE request_id = ${requestId} AND approver_id = ${approverId}`.pipe(Effect.asVoid),
          "Failed to record decision",
        ),

      getApprovals: (requestId) =>
        withErr(
          sql`SELECT * FROM request_approvals WHERE request_id = ${requestId}`.pipe(
            Effect.map((rows) => rows.map((r) => decodeRequestApproval(r) as RequestApproval)),
          ),
          "Failed to get approvals",
        ),

      createApprovalRecords: (requestId, approverIds) =>
        withErr(
          Effect.forEach(
            approverIds,
            (approverId) =>
              sql`INSERT INTO request_approvals (request_id, approver_id) VALUES (${requestId}, ${approverId})`,
          ).pipe(Effect.asVoid),
          "Failed to create approval records",
        ),

      updateStatus: (requestId, status) =>
        withErr(
          sql`UPDATE access_requests
              SET status = ${status},
                  resolved_at = CASE WHEN ${status} IN ('approved','rejected','cancelled') THEN NOW() ELSE resolved_at END
              WHERE id = ${requestId}`.pipe(Effect.asVoid),
          "Failed to update access request status",
        ),

      linkGrant: (requestId, grantId) =>
        withErr(
          sql`UPDATE access_requests SET grant_id = ${grantId} WHERE id = ${requestId}`.pipe(Effect.asVoid),
          "Failed to link grant to access request",
        ),

      findApprovalPolicy: (applicationId, roleId, entitlementId) =>
        withErr(
          sql`SELECT * FROM approval_policies
              WHERE application_id = ${applicationId}
                AND (
                  (scope_type = 'entitlement' AND scope_id = ${entitlementId ?? null}::text)
                  OR (scope_type = 'role' AND scope_id = ${roleId ?? null}::text)
                  OR (scope_type = 'application' AND scope_id IS NULL)
                )
              ORDER BY CASE scope_type WHEN 'entitlement' THEN 1 WHEN 'role' THEN 2 ELSE 3 END
              LIMIT 1`.pipe(
            Effect.map((rows) => (rows.length > 0 ? (decodeApprovalPolicy(rows[0]) as ApprovalPolicy) : null)),
          ),
          "Failed to find approval policy",
        ),
    }
  }),
)
