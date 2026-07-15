import { Context, Effect, Data, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import * as SqlError from "@effect/sql/SqlError"
import { MigrationsRan } from "~/lib/db/client.server"
import { decodeAccessInvitation, type AccessInvitation } from "./types"

export class AccessInvitationRepoError extends Data.TaggedError("AccessInvitationRepoError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

const withErr = <A>(effect: Effect.Effect<A, SqlError.SqlError>, message: string) =>
  effect.pipe(Effect.mapError((e) => new AccessInvitationRepoError({ message, cause: e })))

/** An invitation joined with the display names its UI needs. */
export interface AccessInvitationEnriched {
  readonly id: string
  readonly status: string
  readonly applicationId: string
  readonly applicationName: string | null
  readonly roleId: string | null
  readonly roleName: string | null
  readonly entitlementId: string | null
  readonly entitlementName: string | null
  readonly invitedPrincipalId: string
  readonly invitedPrincipalName: string | null
  readonly invitedByName: string | null
  readonly message: string | null
  readonly createdAt: string
  readonly expiresAt: string | null
}

const toEnriched = (r: any): AccessInvitationEnriched => ({
  id: r.id,
  status: r.status,
  applicationId: r.applicationId,
  applicationName: r.applicationName ?? null,
  roleId: r.roleId ?? null,
  roleName: r.roleName ?? null,
  entitlementId: r.entitlementId ?? null,
  entitlementName: r.entitlementName ?? null,
  invitedPrincipalId: r.invitedPrincipalId,
  invitedPrincipalName: r.invitedPrincipalName ?? null,
  invitedByName: r.invitedByName ?? null,
  message: r.message ?? null,
  createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date(r.createdAt).toISOString(),
  expiresAt: r.expiresAt ? (typeof r.expiresAt === "string" ? r.expiresAt : new Date(r.expiresAt).toISOString()) : null,
})

export class AccessInvitationRepo extends Context.Tag("AccessInvitationRepo")<
  AccessInvitationRepo,
  {
    readonly create: (input: {
      applicationId: string
      roleId?: string
      entitlementId?: string
      resourceId?: string
      invitedPrincipalId: string
      invitedBy: string
      message?: string
      expiresAt?: string
    }) => Effect.Effect<AccessInvitation, AccessInvitationRepoError>
    readonly findById: (id: string) => Effect.Effect<AccessInvitation | null, AccessInvitationRepoError>
    readonly listForPrincipal: (principalId: string) => Effect.Effect<AccessInvitation[], AccessInvitationRepoError>
    readonly listForApp: (applicationId: string) => Effect.Effect<AccessInvitation[], AccessInvitationRepoError>
    /** Pending, non-expired invitations for a principal, with display names — the invitee inbox. */
    readonly listPendingForPrincipalEnriched: (
      principalId: string,
    ) => Effect.Effect<AccessInvitationEnriched[], AccessInvitationRepoError>
    /** All invitations (any status) with display names — the admin table. */
    readonly listAllEnriched: () => Effect.Effect<AccessInvitationEnriched[], AccessInvitationRepoError>
    /**
     * Accept — atomic and conditional on `pending`. Returns the affected count
     * (0 if it was already resolved by a concurrent action) so callers can
     * detect a race instead of double-granting.
     */
    readonly accept: (id: string, grantId: string) => Effect.Effect<number, AccessInvitationRepoError>
    /** Decline — atomic and conditional on `pending`. Returns affected count. */
    readonly decline: (id: string) => Effect.Effect<number, AccessInvitationRepoError>
    /** Expire a single invitation if still pending. Returns affected count. */
    readonly expire: (id: string) => Effect.Effect<number, AccessInvitationRepoError>
    /**
     * Bulk-transition every pending invitation whose `expires_at` has passed to
     * `expired`. Called lazily from the inbox/admin loaders so stale rows don't
     * linger as pending forever (and the admin pending-count badge can clear).
     * Returns the number expired.
     */
    readonly markExpired: () => Effect.Effect<number, AccessInvitationRepoError>
  }
>() {}

export const AccessInvitationRepoLive = Layer.effect(
  AccessInvitationRepo,
  Effect.gen(function* () {
    yield* MigrationsRan
    const sql = yield* SqlClient.SqlClient

    return {
      create: (input) =>
        withErr(
          sql`INSERT INTO access_invitations (application_id, role_id, entitlement_id, resource_id, invited_principal_id, invited_by, message, expires_at)
              VALUES (${input.applicationId}, ${input.roleId ?? null}, ${input.entitlementId ?? null}, ${input.resourceId ?? null}, ${input.invitedPrincipalId}, ${input.invitedBy}, ${input.message ?? null}, ${input.expiresAt ?? null})
              RETURNING *`.pipe(Effect.map((rows) => decodeAccessInvitation(rows[0]) as AccessInvitation)),
          "Failed to create access invitation",
        ),

      findById: (id) =>
        withErr(
          sql`SELECT * FROM access_invitations WHERE id = ${id}`.pipe(
            Effect.map((rows) => (rows.length > 0 ? (decodeAccessInvitation(rows[0]) as AccessInvitation) : null)),
          ),
          "Failed to find access invitation",
        ),

      listForPrincipal: (principalId) =>
        withErr(
          sql`SELECT * FROM access_invitations
              WHERE invited_principal_id = ${principalId}
              ORDER BY created_at DESC`.pipe(
            Effect.map((rows) => rows.map((r) => decodeAccessInvitation(r) as AccessInvitation)),
          ),
          "Failed to list invitations for principal",
        ),

      listForApp: (applicationId) =>
        withErr(
          sql`SELECT * FROM access_invitations
              WHERE application_id = ${applicationId}
              ORDER BY created_at DESC`.pipe(
            Effect.map((rows) => rows.map((r) => decodeAccessInvitation(r) as AccessInvitation)),
          ),
          "Failed to list invitations for application",
        ),

      listPendingForPrincipalEnriched: (principalId) =>
        withErr(
          sql`SELECT ai.id, ai.status, ai.application_id, ai.role_id, ai.entitlement_id,
                     ai.invited_principal_id, ai.message, ai.created_at, ai.expires_at,
                     app.display_name AS application_name,
                     r.display_name AS role_name,
                     e.display_name AS entitlement_name,
                     inviter.display_name AS invited_by_name
              FROM access_invitations ai
              LEFT JOIN applications app ON app.id = ai.application_id
              LEFT JOIN roles r ON r.id = ai.role_id
              LEFT JOIN entitlements e ON e.id = ai.entitlement_id
              LEFT JOIN principals inviter ON inviter.id = ai.invited_by
              WHERE ai.invited_principal_id = ${principalId}
                AND ai.status = 'pending'
                AND (ai.expires_at IS NULL OR ai.expires_at > NOW())
              ORDER BY ai.created_at DESC`.pipe(Effect.map((rows) => rows.map(toEnriched))),
          "Failed to list pending invitations for principal",
        ),

      listAllEnriched: () =>
        withErr(
          sql`SELECT ai.id, ai.status, ai.application_id, ai.role_id, ai.entitlement_id,
                     ai.invited_principal_id, ai.message, ai.created_at, ai.expires_at,
                     app.display_name AS application_name,
                     r.display_name AS role_name,
                     e.display_name AS entitlement_name,
                     invited.display_name AS invited_principal_name,
                     inviter.display_name AS invited_by_name
              FROM access_invitations ai
              LEFT JOIN applications app ON app.id = ai.application_id
              LEFT JOIN roles r ON r.id = ai.role_id
              LEFT JOIN entitlements e ON e.id = ai.entitlement_id
              LEFT JOIN principals invited ON invited.id = ai.invited_principal_id
              LEFT JOIN principals inviter ON inviter.id = ai.invited_by
              ORDER BY ai.created_at DESC`.pipe(Effect.map((rows) => rows.map(toEnriched))),
          "Failed to list all invitations",
        ),

      accept: (id, grantId) =>
        withErr(
          sql`UPDATE access_invitations
              SET status = 'accepted', grant_id = ${grantId}, resolved_at = NOW()
              WHERE id = ${id} AND status = 'pending'
              RETURNING id`.pipe(Effect.map((rows) => rows.length)),
          "Failed to accept invitation",
        ),

      decline: (id) =>
        withErr(
          sql`UPDATE access_invitations
              SET status = 'declined', resolved_at = NOW()
              WHERE id = ${id} AND status = 'pending'
              RETURNING id`.pipe(Effect.map((rows) => rows.length)),
          "Failed to decline invitation",
        ),

      expire: (id) =>
        withErr(
          sql`UPDATE access_invitations
              SET status = 'expired', resolved_at = NOW()
              WHERE id = ${id} AND status = 'pending'
              RETURNING id`.pipe(Effect.map((rows) => rows.length)),
          "Failed to expire invitation",
        ),

      markExpired: () =>
        withErr(
          sql`UPDATE access_invitations
              SET status = 'expired', resolved_at = NOW()
              WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= NOW()
              RETURNING id`.pipe(Effect.map((rows) => rows.length)),
          "Failed to expire stale invitations",
        ),
    }
  }),
)
