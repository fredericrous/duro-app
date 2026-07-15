import { Effect, Data } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { AccessInvitationRepo } from "~/lib/governance/AccessInvitationRepo.server"
import { GrantRepo } from "~/lib/governance/GrantRepo.server"
import { AuditService } from "~/lib/governance/AuditService.server"
import { DiscordNotifier } from "~/lib/services/DiscordNotifier.server"
import { activateGrant } from "~/lib/workflows/grant-activation.server"

/**
 * Access-invitation lifecycle: an admin invites an existing principal to a
 * role/entitlement on an app; the invitee accepts (which mints + activates the
 * grant) or declines. Accepting is the one path that materialises access, so it
 * is guarded for idempotency and ownership the same way approvals are.
 */
export class AccessInvitationError extends Data.TaggedError("AccessInvitationError")<{
  readonly code: "not_found" | "not_yours" | "not_pending" | "expired" | "no_target" | "db"
  readonly message?: string
}> {}

export interface AcceptInput {
  invitationId: string
  /** Governance principal id of the caller — must match the invited principal. */
  principalId: string
}

/**
 * Accept an invitation: mint the grant it describes, mark it accepted, and
 * enqueue provisioning. Only the invited principal may accept, and only while
 * the invitation is still pending and unexpired. Row-locked + status-guarded so
 * a double-submit cannot mint two grants.
 */
export const acceptInvitation = (input: { invitationId: string; principalId: string }) =>
  Effect.gen(function* () {
    const invRepo = yield* AccessInvitationRepo
    const grantRepo = yield* GrantRepo
    const audit = yield* AuditService
    const sql = yield* SqlClient.SqlClient

    // Cheap validation OUTSIDE the grant transaction. In particular, expiring a
    // past-due invitation must be committed even though we then reject the
    // accept — doing it inside the transaction below would roll the expiry back
    // when the effect fails.
    const pre = yield* invRepo
      .findById(input.invitationId)
      .pipe(Effect.mapError(() => new AccessInvitationError({ code: "db" })))
    if (!pre) return yield* new AccessInvitationError({ code: "not_found" })
    if (pre.invitedPrincipalId !== input.principalId) return yield* new AccessInvitationError({ code: "not_yours" })
    if (pre.status !== "pending") return yield* new AccessInvitationError({ code: "not_pending" })
    if (pre.expiresAt && new Date(pre.expiresAt).getTime() <= Date.now()) {
      yield* invRepo.expire(input.invitationId).pipe(Effect.mapError(() => new AccessInvitationError({ code: "db" })))
      return yield* new AccessInvitationError({ code: "expired" })
    }
    if (!pre.roleId && !pre.entitlementId) return yield* new AccessInvitationError({ code: "no_target" })

    const outcome = yield* sql.withTransaction(
      Effect.gen(function* () {
        // Lock the row so two concurrent accepts serialize, then re-check status
        // under the lock — the conditional accept below is the real guard.
        yield* sql`SELECT id FROM access_invitations WHERE id = ${input.invitationId} FOR UPDATE`.pipe(
          Effect.mapError(() => new AccessInvitationError({ code: "db" })),
        )
        const inv = yield* invRepo
          .findById(input.invitationId)
          .pipe(Effect.mapError(() => new AccessInvitationError({ code: "db" })))

        if (!inv) return yield* new AccessInvitationError({ code: "not_found" })
        if (inv.status !== "pending") return yield* new AccessInvitationError({ code: "not_pending" })

        const grant = inv.roleId
          ? yield* grantRepo
              .grantRole({
                principalId: inv.invitedPrincipalId,
                roleId: inv.roleId,
                resourceId: inv.resourceId ?? undefined,
                grantedBy: inv.invitedBy,
                reason: "access invitation accepted",
              })
              .pipe(Effect.mapError(() => new AccessInvitationError({ code: "db" })))
          : yield* grantRepo
              .grantEntitlement({
                principalId: inv.invitedPrincipalId,
                entitlementId: inv.entitlementId as string,
                resourceId: inv.resourceId ?? undefined,
                grantedBy: inv.invitedBy,
                reason: "access invitation accepted",
              })
              .pipe(Effect.mapError(() => new AccessInvitationError({ code: "db" })))

        // Conditional accept — 0 rows means a concurrent action already resolved
        // it; treat as not_pending so we don't leave a dangling grant.
        const affected = yield* invRepo
          .accept(input.invitationId, grant.id)
          .pipe(Effect.mapError(() => new AccessInvitationError({ code: "db" })))
        if (affected === 0) return yield* new AccessInvitationError({ code: "not_pending" })

        yield* audit
          .emit({
            eventType: "access_invitation.accepted",
            actorId: input.principalId,
            targetType: "access_invitation",
            targetId: input.invitationId,
            applicationId: inv.applicationId,
            metadata: { grantId: grant.id },
          })
          .pipe(Effect.catchAll(() => Effect.void))

        return { grantId: grant.id, applicationId: inv.applicationId }
      }),
    )

    // Provision outside the transaction (enqueues + forks the job).
    yield* activateGrant(outcome.grantId).pipe(Effect.mapError(() => new AccessInvitationError({ code: "db" })))

    const discord = yield* DiscordNotifier
    yield* discord.notify(`Access invitation accepted for application ${outcome.applicationId}`)

    return outcome
  }).pipe(Effect.withSpan("acceptInvitation", { attributes: { invitationId: input.invitationId } }))

/** Decline an invitation. Only the invited principal may decline; pending-only. */
export const declineInvitation = (input: { invitationId: string; principalId: string }) =>
  Effect.gen(function* () {
    const invRepo = yield* AccessInvitationRepo
    const audit = yield* AuditService

    const inv = yield* invRepo
      .findById(input.invitationId)
      .pipe(Effect.mapError(() => new AccessInvitationError({ code: "db" })))
    if (!inv) return yield* new AccessInvitationError({ code: "not_found" })
    if (inv.invitedPrincipalId !== input.principalId) return yield* new AccessInvitationError({ code: "not_yours" })

    const affected = yield* invRepo
      .decline(input.invitationId)
      .pipe(Effect.mapError(() => new AccessInvitationError({ code: "db" })))
    if (affected === 0) return yield* new AccessInvitationError({ code: "not_pending" })

    yield* audit
      .emit({
        eventType: "access_invitation.declined",
        actorId: input.principalId,
        targetType: "access_invitation",
        targetId: input.invitationId,
        applicationId: inv.applicationId,
      })
      .pipe(Effect.catchAll(() => Effect.void))
  }).pipe(Effect.withSpan("declineInvitation", { attributes: { invitationId: input.invitationId } }))

/**
 * Admin retracts a still-pending invitation. Records it as declined (the status
 * enum has no dedicated "cancelled" state) with the admin as actor.
 */
export const cancelInvitation = (input: { invitationId: string; adminPrincipalId: string }) =>
  Effect.gen(function* () {
    const invRepo = yield* AccessInvitationRepo
    const audit = yield* AuditService

    const inv = yield* invRepo
      .findById(input.invitationId)
      .pipe(Effect.mapError(() => new AccessInvitationError({ code: "db" })))
    if (!inv) return yield* new AccessInvitationError({ code: "not_found" })

    const affected = yield* invRepo
      .decline(input.invitationId)
      .pipe(Effect.mapError(() => new AccessInvitationError({ code: "db" })))
    if (affected === 0) return yield* new AccessInvitationError({ code: "not_pending" })

    yield* audit
      .emit({
        eventType: "access_invitation.cancelled",
        actorId: input.adminPrincipalId,
        targetType: "access_invitation",
        targetId: input.invitationId,
        applicationId: inv.applicationId,
      })
      .pipe(Effect.catchAll(() => Effect.void))
  }).pipe(Effect.withSpan("cancelInvitation", { attributes: { invitationId: input.invitationId } }))
