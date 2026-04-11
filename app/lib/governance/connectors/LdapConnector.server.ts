import { Context, Effect, Data, Layer, Schedule } from "effect"
import { GrantRepo } from "~/lib/governance/GrantRepo.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import { RbacRepo } from "~/lib/governance/RbacRepo.server"
import { ConnectedSystemRepo } from "~/lib/governance/ConnectedSystemRepo.server"
import { ConnectorMappingRepo } from "~/lib/governance/ConnectorMappingRepo.server"
import { LldapClient, type LldapError } from "~/lib/services/LldapClient.server"

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class LdapConnectorError extends Data.TaggedError("LdapConnectorError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

// ---------------------------------------------------------------------------
// Service tag — clean interface with no context requirements. All dependencies
// are captured at Layer build time so callers only need `LdapConnector`.
// ---------------------------------------------------------------------------

export class LdapConnector extends Context.Tag("LdapConnector")<
  LdapConnector,
  {
    readonly provisionGrant: (grantId: string) => Effect.Effect<void, LdapConnectorError>
    readonly deprovisionGrant: (grantId: string) => Effect.Effect<void, LdapConnectorError>
  }
>() {}

// ---------------------------------------------------------------------------
// Retry schedule — exponential backoff, max 3 attempts, for transient LLDAP
// network failures. Applied selectively to LDAP network calls (not to DB
// lookups — those already live inside a request-scoped sql client).
// ---------------------------------------------------------------------------

const ldapRetrySchedule = Schedule.exponential("200 millis").pipe(Schedule.intersect(Schedule.recurs(3)))

const wrapLldapError =
  (context: string) =>
  (cause: LldapError): LdapConnectorError =>
    new LdapConnectorError({ message: `LLDAP ${context}: ${cause.message}`, cause })

// ---------------------------------------------------------------------------
// Live layer — captures all dependencies at build time
// ---------------------------------------------------------------------------

export const LdapConnectorLive = Layer.effect(
  LdapConnector,
  Effect.gen(function* () {
    const grantRepo = yield* GrantRepo
    const principalRepo = yield* PrincipalRepo
    const rbac = yield* RbacRepo
    const connectedSystems = yield* ConnectedSystemRepo
    const connectorMappings = yield* ConnectorMappingRepo
    const lldap = yield* LldapClient

    // --- Retry-wrapped LLDAP operations ---------------------------------

    const ensureGroupRetried = (name: string) =>
      lldap.ensureGroup(name).pipe(
        Effect.retry(ldapRetrySchedule),
        Effect.mapError(wrapLldapError(`ensureGroup ${name}`)),
      )

    const addUserToGroupRetried = (userId: string, groupId: number) =>
      lldap.addUserToGroup(userId, groupId).pipe(
        Effect.retry(ldapRetrySchedule),
        Effect.mapError(wrapLldapError(`addUserToGroup ${userId}→${groupId}`)),
      )

    const removeUserFromGroupRetried = (userId: string, groupId: number) =>
      lldap.removeUserFromGroup(userId, groupId).pipe(
        Effect.retry(ldapRetrySchedule),
        Effect.mapError(wrapLldapError(`removeUserFromGroup ${userId}→${groupId}`)),
      )

    /**
     * Read-only group lookup. Unlike `ensureGroup`, this does NOT create the
     * group if missing — used on the deprovision path where creating a group
     * just to remove someone from it would be wrong (leaves ghost groups).
     */
    const findGroupByName = (name: string) =>
      lldap.getGroups.pipe(
        Effect.retry(ldapRetrySchedule),
        Effect.mapError(wrapLldapError(`getGroups (looking for ${name})`)),
        Effect.map((groups) => groups.find((g) => g.displayName === name) ?? null),
      )

    // --- DB resolution (no retry — sql calls don't need it) -------------

    const resolveContext = (grantId: string) =>
      Effect.gen(function* () {
        const grant = yield* grantRepo
          .findById(grantId)
          .pipe(
            Effect.mapError(
              (e) => new LdapConnectorError({ message: `Failed to load grant ${grantId}`, cause: e }),
            ),
          )
        if (!grant) {
          return yield* new LdapConnectorError({ message: `Grant ${grantId} not found` })
        }
        if (!grant.roleId) {
          return yield* new LdapConnectorError({
            message: `Grant ${grantId} has no roleId; LDAP connector only supports role grants`,
          })
        }

        const principal = yield* principalRepo
          .findById(grant.principalId)
          .pipe(Effect.mapError((e) => new LdapConnectorError({ message: `Failed to load principal`, cause: e })))
        if (!principal) {
          return yield* new LdapConnectorError({ message: `Principal ${grant.principalId} not found` })
        }

        const role = yield* rbac
          .findRoleById(grant.roleId)
          .pipe(Effect.mapError((e) => new LdapConnectorError({ message: `Failed to load role`, cause: e })))
        if (!role) {
          return yield* new LdapConnectorError({ message: `Role ${grant.roleId} not found` })
        }

        const system = yield* connectedSystems
          .findByApplicationAndType(role.applicationId, "ldap")
          .pipe(
            Effect.mapError(
              (e) => new LdapConnectorError({ message: `Failed to find LDAP connected system`, cause: e }),
            ),
          )
        if (!system) {
          return yield* new LdapConnectorError({
            message: `No LDAP ConnectedSystem for application ${role.applicationId}`,
          })
        }

        const mapping = yield* connectorMappings
          .findByConnectedSystemAndRole(system.id, grant.roleId)
          .pipe(
            Effect.mapError(
              (e) => new LdapConnectorError({ message: `Failed to find connector mapping`, cause: e }),
            ),
          )
        if (!mapping) {
          return yield* new LdapConnectorError({
            message: `No ConnectorMapping for role ${grant.roleId} on system ${system.id}`,
          })
        }

        return {
          grant,
          principal,
          applicationId: role.applicationId,
          connectedSystemId: system.id,
          externalRoleIdentifier: mapping.externalRoleIdentifier,
        }
      })

    return {
      provisionGrant: (grantId: string) =>
        Effect.gen(function* () {
          const ctx = yield* resolveContext(grantId)

          if (ctx.principal.principalType !== "user") {
            yield* Effect.logWarning("LdapConnector provision skipped: non-user principal").pipe(
              Effect.annotateLogs({
                component: "LdapConnector",
                grantId,
                principalId: ctx.principal.id,
                principalType: ctx.principal.principalType,
              }),
            )
            return
          }

          if (!ctx.principal.externalId) {
            return yield* new LdapConnectorError({
              message: `Principal ${ctx.principal.id} has no externalId — cannot resolve LLDAP user`,
            })
          }

          const groupId = yield* ensureGroupRetried(ctx.externalRoleIdentifier)
          yield* addUserToGroupRetried(ctx.principal.externalId, groupId)

          yield* Effect.log("LdapConnector provision succeeded").pipe(
            Effect.annotateLogs({
              component: "LdapConnector",
              grantId,
              principalExternalId: ctx.principal.externalId,
              externalRoleIdentifier: ctx.externalRoleIdentifier,
            }),
          )
        }),

      deprovisionGrant: (grantId: string) =>
        Effect.gen(function* () {
          const ctx = yield* resolveContext(grantId)

          if (ctx.principal.principalType !== "user") {
            yield* Effect.logWarning("LdapConnector deprovision skipped: non-user principal").pipe(
              Effect.annotateLogs({
                component: "LdapConnector",
                grantId,
                principalId: ctx.principal.id,
                principalType: ctx.principal.principalType,
              }),
            )
            return
          }

          if (!ctx.principal.externalId) {
            return yield* new LdapConnectorError({
              message: `Principal ${ctx.principal.id} has no externalId`,
            })
          }

          // Over-revoke safety (invariant 4): skip removal if the user still
          // has another active grant that maps to the same external group.
          const hasOther = yield* grantRepo
            .hasOtherActiveMappingTo({
              excludeGrantId: ctx.grant.id,
              principalId: ctx.principal.id,
              connectedSystemId: ctx.connectedSystemId,
              externalRoleIdentifier: ctx.externalRoleIdentifier,
            })
            .pipe(
              Effect.mapError(
                (e) => new LdapConnectorError({ message: "Failed to check for other active grants", cause: e }),
              ),
            )

          if (hasOther) {
            yield* Effect.log("LdapConnector deprovision no-op: other active grant maps to same group").pipe(
              Effect.annotateLogs({
                component: "LdapConnector",
                grantId,
                principalExternalId: ctx.principal.externalId,
                externalRoleIdentifier: ctx.externalRoleIdentifier,
              }),
            )
            return
          }

          // Look up the group in LLDAP — do NOT create it just to remove
          // someone. If the group is missing (drift, manual deletion), the
          // user can't be in it, so the removal is a no-op.
          const group = yield* findGroupByName(ctx.externalRoleIdentifier)
          if (!group) {
            yield* Effect.logWarning("LdapConnector deprovision no-op: group missing in LLDAP").pipe(
              Effect.annotateLogs({
                component: "LdapConnector",
                grantId,
                externalRoleIdentifier: ctx.externalRoleIdentifier,
              }),
            )
            return
          }

          yield* removeUserFromGroupRetried(ctx.principal.externalId, group.id)

          yield* Effect.log("LdapConnector deprovision succeeded").pipe(
            Effect.annotateLogs({
              component: "LdapConnector",
              grantId,
              principalExternalId: ctx.principal.externalId,
              externalRoleIdentifier: ctx.externalRoleIdentifier,
            }),
          )
        }),
    }
  }),
)

// ---------------------------------------------------------------------------
// Dev layer — LldapClient is not available in dev; no-op
// ---------------------------------------------------------------------------

export const LdapConnectorDev = Layer.succeed(LdapConnector, {
  provisionGrant: (grantId: string) =>
    Effect.log("[LdapConnector/dev] provisionGrant (no-op)").pipe(
      Effect.annotateLogs({ grantId }),
      Effect.asVoid,
    ),
  deprovisionGrant: (grantId: string) =>
    Effect.log("[LdapConnector/dev] deprovisionGrant (no-op)").pipe(
      Effect.annotateLogs({ grantId }),
      Effect.asVoid,
    ),
})
