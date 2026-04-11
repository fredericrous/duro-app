import { Context, Effect, Data, Layer } from "effect"
import { GrantRepo } from "~/lib/governance/GrantRepo.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import { RbacRepo } from "~/lib/governance/RbacRepo.server"
import { ConnectedSystemRepo } from "~/lib/governance/ConnectedSystemRepo.server"
import { ConnectorMappingRepo } from "~/lib/governance/ConnectorMappingRepo.server"
import { LldapClient } from "~/lib/services/LldapClient.server"

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
            yield* Effect.logWarning(
              `[LdapConnector] provision skipped: non-user principal ${ctx.principal.id} (type=${ctx.principal.principalType})`,
            )
            return
          }

          if (!ctx.principal.externalId) {
            return yield* new LdapConnectorError({
              message: `Principal ${ctx.principal.id} has no externalId — cannot resolve LLDAP user`,
            })
          }

          const groupId = yield* lldap
            .ensureGroup(ctx.externalRoleIdentifier)
            .pipe(
              Effect.mapError(
                (e) =>
                  new LdapConnectorError({
                    message: `Failed to ensure LLDAP group ${ctx.externalRoleIdentifier}`,
                    cause: e,
                  }),
              ),
            )

          yield* lldap
            .addUserToGroup(ctx.principal.externalId, groupId)
            .pipe(
              Effect.mapError(
                (e) =>
                  new LdapConnectorError({
                    message: `Failed to add ${ctx.principal.externalId} to ${ctx.externalRoleIdentifier}`,
                    cause: e,
                  }),
              ),
            )
        }),

      deprovisionGrant: (grantId: string) =>
        Effect.gen(function* () {
          const ctx = yield* resolveContext(grantId)

          if (ctx.principal.principalType !== "user") {
            yield* Effect.logWarning(`[LdapConnector] deprovision skipped: non-user principal ${ctx.principal.id}`)
            return
          }

          if (!ctx.principal.externalId) {
            return yield* new LdapConnectorError({
              message: `Principal ${ctx.principal.id} has no externalId`,
            })
          }

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
            yield* Effect.log(
              `[LdapConnector] deprovision no-op: another active grant maps ${ctx.principal.externalId} to ${ctx.externalRoleIdentifier}`,
            )
            return
          }

          const groupId = yield* lldap
            .ensureGroup(ctx.externalRoleIdentifier)
            .pipe(
              Effect.mapError(
                (e) =>
                  new LdapConnectorError({
                    message: `Failed to ensure LLDAP group ${ctx.externalRoleIdentifier}`,
                    cause: e,
                  }),
              ),
            )

          yield* lldap
            .removeUserFromGroup(ctx.principal.externalId, groupId)
            .pipe(
              Effect.mapError(
                (e) =>
                  new LdapConnectorError({
                    message: `Failed to remove ${ctx.principal.externalId} from ${ctx.externalRoleIdentifier}`,
                    cause: e,
                  }),
              ),
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
    Effect.log(`[LdapConnector/dev] provisionGrant grantId=${grantId} (no-op)`).pipe(Effect.asVoid),
  deprovisionGrant: (grantId: string) =>
    Effect.log(`[LdapConnector/dev] deprovisionGrant grantId=${grantId} (no-op)`).pipe(Effect.asVoid),
})
