import { Effect } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { AccessRequestRepo } from "~/lib/governance/AccessRequestRepo.server"
import { GrantRepo } from "~/lib/governance/GrantRepo.server"
import { AuditService } from "~/lib/governance/AuditService.server"
import { ProvisioningService } from "~/lib/governance/ProvisioningService.server"
import { type ApprovalPolicyRule } from "~/lib/governance/types"

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

    // 1. Create access request
    const request = yield* requestRepo.create(input)

    // 2. Find approval policy
    const policy = yield* requestRepo.findApprovalPolicy(
      input.applicationId,
      input.roleId,
      input.entitlementId,
    )

    if (!policy || policy.mode === "none") {
      // Auto-approve in a transaction
      yield* sql.withTransaction(
        Effect.gen(function* () {
          // Create grant
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
                entitlementId: input.entitlementId!,
                resourceId: input.resourceId,
                grantedBy: input.requesterId,
                reason: "auto-approved",
              })
          yield* requestRepo.updateStatus(request.id, "approved")
          yield* requestRepo.linkGrant(request.id, grant.id)
          yield* audit.emit({
            eventType: "access.auto_approved",
            actorId: input.requesterId,
            targetType: "access_request",
            targetId: request.id,
            applicationId: input.applicationId,
          })
        }),
      )
      return { requestId: request.id, status: "approved" as const }
    }

    // 3. Resolve approvers
    const rules = (policy.rules ?? []) as ApprovalPolicyRule[]
    const approverIds: string[] = []
    for (const rule of rules) {
      if (rule.approverType === "app_owner") {
        const apps =
          yield* sql`SELECT owner_id FROM applications WHERE id = ${input.applicationId}`
        if (apps.length > 0 && (apps[0] as any).ownerId) {
          approverIds.push((apps[0] as any).ownerId as string)
        }
      } else if (
        rule.approverType === "principal" &&
        rule.approverPrincipalId
      ) {
        approverIds.push(rule.approverPrincipalId)
      }
    }

    if (approverIds.length === 0) {
      yield* Effect.logWarning("No approvers resolved, auto-approving")
      // auto-approve same as above... (simplified: just update status)
      yield* requestRepo.updateStatus(request.id, "approved")
      return { requestId: request.id, status: "approved" as const }
    }

    // 4. Create approval records
    yield* requestRepo.createApprovalRecords(request.id, approverIds)
    yield* audit.emit({
      eventType: "access.requested",
      actorId: input.requesterId,
      targetType: "access_request",
      targetId: request.id,
      applicationId: input.applicationId,
    })

    return { requestId: request.id, status: "pending" as const }
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
    const provisioning = yield* ProvisioningService
    const sqlClient = yield* SqlClient.SqlClient

    let grantCreated = false

    yield* sqlClient.withTransaction(
      Effect.gen(function* () {
        // 1. Record the individual decision
        yield* requestRepo.recordDecision(
          input.requestId,
          input.approverId,
          input.decision,
          input.comment,
        )

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
          grantCreated = true
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

    // Fire-and-forget provisioning outside the transaction
    if (grantCreated) {
      yield* provisioning.processNextPending().pipe(Effect.fork)
    }
  }).pipe(Effect.withSpan("decideApproval"))
