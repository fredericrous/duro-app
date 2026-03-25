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
    readonly findById: (
      id: string,
    ) => Effect.Effect<AccessInvitation | null, AccessInvitationRepoError>
    readonly listForPrincipal: (
      principalId: string,
    ) => Effect.Effect<AccessInvitation[], AccessInvitationRepoError>
    readonly listForApp: (
      applicationId: string,
    ) => Effect.Effect<AccessInvitation[], AccessInvitationRepoError>
    readonly accept: (
      id: string,
      grantId: string,
    ) => Effect.Effect<void, AccessInvitationRepoError>
    readonly decline: (id: string) => Effect.Effect<void, AccessInvitationRepoError>
    readonly expire: (id: string) => Effect.Effect<void, AccessInvitationRepoError>
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
              RETURNING *`.pipe(
            Effect.map((rows) => decodeAccessInvitation(rows[0]) as AccessInvitation),
          ),
          "Failed to create access invitation",
        ),

      findById: (id) =>
        withErr(
          sql`SELECT * FROM access_invitations WHERE id = ${id}`.pipe(
            Effect.map((rows) =>
              rows.length > 0 ? (decodeAccessInvitation(rows[0]) as AccessInvitation) : null,
            ),
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

      accept: (id, grantId) =>
        withErr(
          sql`UPDATE access_invitations
              SET status = 'accepted', grant_id = ${grantId}, resolved_at = NOW()
              WHERE id = ${id}`.pipe(Effect.asVoid),
          "Failed to accept invitation",
        ),

      decline: (id) =>
        withErr(
          sql`UPDATE access_invitations
              SET status = 'declined', resolved_at = NOW()
              WHERE id = ${id}`.pipe(Effect.asVoid),
          "Failed to decline invitation",
        ),

      expire: (id) =>
        withErr(
          sql`UPDATE access_invitations
              SET status = 'expired', resolved_at = NOW()
              WHERE id = ${id}`.pipe(Effect.asVoid),
          "Failed to expire invitation",
        ),
    }
  }),
)
