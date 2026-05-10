import { Data, Effect } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { AccessRequestRepo } from "~/lib/governance/AccessRequestRepo.server"
import { GrantRepo } from "~/lib/governance/GrantRepo.server"
import { AuditService } from "~/lib/governance/AuditService.server"
import { activateGrant } from "./grant-activation.server"
import { type ApprovalPolicyRule } from "~/lib/governance/types"

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export class MissingRoleOrEntitlementError extends Data.TaggedError("MissingRoleOrEntitlementError")<{
  readonly applicationId: string
}> {}

export class BothRoleAndEntitlementError extends Data.TaggedError("BothRoleAndEntitlementError")<{
  readonly applicationId: string
}> {}

export class RoleEntitlementAppMismatchError extends Data.TaggedError("RoleEntitlementAppMismatchError")<{
  readonly applicationId: string
  readonly target: "role" | "entitlement"
  readonly targetId: string
}> {}

export class AccessRequestNotOwnedError extends Data.TaggedError("AccessRequestNotOwnedError")<{
  readonly requestId: string
}> {}

export class AccessRequestNotCancellableError extends Data.TaggedError("AccessRequestNotCancellableError")<{
  readonly requestId: string
  readonly status: string
}> {}

const isUniqueViolation = (e: unknown): boolean => {
  // Postgres SQLSTATE 23505 — unique_violation. The repo wraps the driver
  // error in SqlError, then in AccessRequestRepoError; the pg `.code` therefore
  // lives a couple of `cause` hops down. Walk the chain instead of guessing.
  let cur: unknown = e
  for (let i = 0; i < 4 && cur; i++) {
    if ((cur as { code?: string }).code === "23505") return true
    cur = (cur as { cause?: unknown }).cause
  }
  return false
}

// ---------------------------------------------------------------------------
// evaluatePolicy — pure function, exported for testing
// ---------------------------------------------------------------------------

export function evaluatePolicy(
  mode: string,
  approvals: Array<{ decision: string | null }>,
): "approved" | "rejected" | "pending" {
  if (mode === "none") return "approved"
  const decided = approvals.filter((a) => a.decision !== null)
  const approved = decided.filter((a) => a.decision === "approved")
  const rejected = decided.filter((a) => a.decision === "rejected")
  if (mode === "one_of") {
    if (approved.length >= 1) return "approved"
    if (rejected.length === approvals.length) return "rejected"
    return "pending"
  }
  if (mode === "all_of") {
    if (rejected.length > 0) return "rejected"
    if (approved.length === approvals.length) return "approved"
    return "pending"
  }
  return "pending"
}

// ---------------------------------------------------------------------------
// submitAccessRequest
// ---------------------------------------------------------------------------

export interface SubmitRequestInput {
  requesterId: string
  applicationId: string
  roleId?: string
  entitlementId?: string
  resourceId?: string
  justification?: string
  requestedDurationHours?: number
}

export const submitAccessRequest = (input: SubmitRequestInput) =>
  Effect.gen(function* () {
    const requestRepo = yield* AccessRequestRepo
    const grantRepo = yield* GrantRepo
    const audit = yield* AuditService
    const sql = yield* SqlClient.SqlClient

    // 0. Validate the request shape against the schema's XOR contract.
    //    The DB CHECK enforces exactly one of role_id / entitlement_id; reject
    //    upstream with a typed error so callers (route action, API handler) can
    //    surface a helpful message instead of a constraint violation.
    if (!input.roleId && !input.entitlementId) {
      return yield* new MissingRoleOrEntitlementError({ applicationId: input.applicationId })
    }
    if (input.roleId && input.entitlementId) {
      return yield* new BothRoleAndEntitlementError({ applicationId: input.applicationId })
    }
    if (input.roleId) {
      const rows =
        yield* sql`SELECT 1 FROM roles WHERE id = ${input.roleId} AND application_id = ${input.applicationId}`
      if (rows.length === 0) {
        return yield* new RoleEntitlementAppMismatchError({
          applicationId: input.applicationId,
          target: "role",
          targetId: input.roleId,
        })
      }
    } else if (input.entitlementId) {
      const rows =
        yield* sql`SELECT 1 FROM entitlements WHERE id = ${input.entitlementId} AND application_id = ${input.applicationId}`
      if (rows.length === 0) {
        return yield* new RoleEntitlementAppMismatchError({
          applicationId: input.applicationId,
          target: "entitlement",
          targetId: input.entitlementId,
        })
      }
    }

    // 1. Create access request — catch unique-violation from the partial
    //    pending-uniq index (migration 0013) and resolve to the existing row.
    const request = yield* requestRepo.create(input).pipe(
      Effect.catchAll((err) =>
        isUniqueViolation(err)
          ? requestRepo.listForRequester(input.requesterId).pipe(
              Effect.map((rows) =>
                rows.find(
                  (r) =>
                    r.status === "pending" &&
                    r.applicationId === input.applicationId &&
                    (r.roleId ?? null) === (input.roleId ?? null) &&
                    (r.entitlementId ?? null) === (input.entitlementId ?? null),
                ),
              ),
              Effect.flatMap((existing) =>
                existing ? Effect.succeed({ duplicate: true as const, request: existing }) : Effect.fail(err),
              ),
            )
          : Effect.fail(err),
      ),
    )

    if ("duplicate" in request && request.duplicate) {
      return { requestId: request.request.id, status: "duplicate" as const }
    }
    const created = "duplicate" in request ? request.request : request

    // 2. Find approval policy
    const policy = yield* requestRepo.findApprovalPolicy(input.applicationId, input.roleId, input.entitlementId)

    if (!policy || policy.mode === "none") {
      // Auto-approve in a transaction. Validation above guarantees exactly
      // one of roleId / entitlementId is set; narrow on roleId to drive both
      // branches without non-null assertions.
      yield* sql.withTransaction(
        Effect.gen(function* () {
          const grant = input.roleId
            ? yield* grantRepo.grantRole({
                principalId: input.requesterId,
                roleId: input.roleId,
                resourceId: input.resourceId,
                grantedBy: input.requesterId,
                reason: "auto-approved",
              })
            : yield* grantRepo.grantEntitlement({
                principalId: input.requesterId,
                entitlementId: input.entitlementId as string,
                resourceId: input.resourceId,
                grantedBy: input.requesterId,
                reason: "auto-approved",
              })
          yield* requestRepo.updateStatus(created.id, "approved")
          yield* requestRepo.linkGrant(created.id, grant.id)
          yield* audit.emit({
            eventType: "access.auto_approved",
            actorId: input.requesterId,
            targetType: "access_request",
            targetId: created.id,
            applicationId: input.applicationId,
          })
        }),
      )
      return { requestId: created.id, status: "approved" as const }
    }

    // 3. Resolve approvers
    const rules = (policy.rules ?? []) as ApprovalPolicyRule[]
    const approverIds: string[] = []
    for (const rule of rules) {
      if (rule.approverType === "app_owner") {
        const apps = yield* sql`SELECT owner_id FROM applications WHERE id = ${input.applicationId}`
        if (apps.length > 0 && (apps[0] as any).ownerId) {
          approverIds.push((apps[0] as any).ownerId as string)
        }
      } else if (rule.approverType === "principal" && rule.approverPrincipalId) {
        approverIds.push(rule.approverPrincipalId)
      }
    }

    if (approverIds.length === 0) {
      yield* Effect.logWarning("No approvers resolved, auto-approving")
      // auto-approve same as above... (simplified: just update status)
      yield* requestRepo.updateStatus(created.id, "approved")
      return { requestId: created.id, status: "approved" as const }
    }

    // 4. Create approval records
    yield* requestRepo.createApprovalRecords(created.id, approverIds)
    yield* audit.emit({
      eventType: "access.requested",
      actorId: input.requesterId,
      targetType: "access_request",
      targetId: created.id,
      applicationId: input.applicationId,
    })

    return { requestId: created.id, status: "pending" as const }
  }).pipe(Effect.withSpan("submitAccessRequest"))

// ---------------------------------------------------------------------------
// decideApproval
// ---------------------------------------------------------------------------

export interface DecideInput {
  requestId: string
  approverId: string
  decision: "approved" | "rejected"
  comment?: string
}

export const decideApproval = (input: DecideInput) =>
  Effect.gen(function* () {
    const requestRepo = yield* AccessRequestRepo
    const grantRepo = yield* GrantRepo
    const audit = yield* AuditService
    const sqlClient = yield* SqlClient.SqlClient

    let newGrantId: string | null = null

    yield* sqlClient.withTransaction(
      Effect.gen(function* () {
        // 1. Record the individual decision
        yield* requestRepo.recordDecision(input.requestId, input.approverId, input.decision, input.comment)

        // 2. Load request + approvals + policy
        const request = yield* requestRepo.findById(input.requestId)
        if (!request) return

        const approvals = yield* requestRepo.getApprovals(input.requestId)
        const policy = yield* requestRepo.findApprovalPolicy(
          request.applicationId,
          request.roleId ?? undefined,
          request.entitlementId ?? undefined,
        )

        // 3. Evaluate
        const result = evaluatePolicy(policy?.mode ?? "one_of", approvals)

        if (result === "approved") {
          const grant = request.roleId
            ? yield* grantRepo.grantRole({
                principalId: request.requesterId,
                roleId: request.roleId,
                resourceId: request.resourceId ?? undefined,
                grantedBy: input.approverId,
                reason: `Approved by ${input.approverId}`,
              })
            : yield* grantRepo.grantEntitlement({
                principalId: request.requesterId,
                entitlementId: request.entitlementId!,
                resourceId: request.resourceId ?? undefined,
                grantedBy: input.approverId,
                reason: `Approved by ${input.approverId}`,
              })
          yield* requestRepo.updateStatus(input.requestId, "approved")
          yield* requestRepo.linkGrant(input.requestId, grant.id)
          yield* audit.emit({
            eventType: "access.approved",
            actorId: input.approverId,
            targetType: "access_request",
            targetId: input.requestId,
            applicationId: request.applicationId,
          })
          newGrantId = grant.id
        } else if (result === "rejected") {
          yield* requestRepo.updateStatus(input.requestId, "rejected")
          yield* audit.emit({
            eventType: "access.rejected",
            actorId: input.approverId,
            targetType: "access_request",
            targetId: input.requestId,
            applicationId: request.applicationId,
          })
        }
        // pending: no action needed
      }),
    )

    // Fire-and-forget provisioning outside the transaction. activateGrant
    // enqueues the job(s) for the new grant AND forks the processing.
    if (newGrantId) {
      yield* activateGrant(newGrantId)
    }
  }).pipe(Effect.withSpan("decideApproval"))

// ---------------------------------------------------------------------------
// cancelOwnAccessRequest
// ---------------------------------------------------------------------------

export interface CancelOwnInput {
  requestId: string
  requesterId: string
}

export const cancelOwnAccessRequest = (input: CancelOwnInput) =>
  Effect.gen(function* () {
    const requestRepo = yield* AccessRequestRepo
    const audit = yield* AuditService

    const request = yield* requestRepo.findById(input.requestId)
    if (!request) {
      return yield* new AccessRequestNotOwnedError({ requestId: input.requestId })
    }
    if (request.requesterId !== input.requesterId) {
      return yield* new AccessRequestNotOwnedError({ requestId: input.requestId })
    }
    if (request.status !== "pending") {
      return yield* new AccessRequestNotCancellableError({ requestId: input.requestId, status: request.status })
    }

    yield* requestRepo.updateStatus(input.requestId, "cancelled")
    yield* audit.emit({
      eventType: "access.cancelled",
      actorId: input.requesterId,
      targetType: "access_request",
      targetId: input.requestId,
      applicationId: request.applicationId,
    })

    return { requestId: input.requestId, status: "cancelled" as const }
  }).pipe(Effect.withSpan("cancelOwnAccessRequest"))
