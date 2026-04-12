import { Cause, Context, Duration, Effect, Exit, Layer, Schema } from "effect"
import { PluginRegistry } from "./PluginRegistry.server"
import { PluginHostError } from "./errors"
import { applyPermissionStrategy, reversePermissionStrategy } from "./interpreter"
import { makeScopedLldapClient } from "./scoped/ScopedLldapClient"
import { makeScopedHttpClient } from "./scoped/ScopedHttpClient"
import { makeScopedVaultClient } from "./scoped/ScopedVaultClient"
import { makeScopedAuditService } from "./scoped/ScopedAuditService"
import type { GrantContext, PluginManifest, PluginServices } from "./contracts"
import { GrantRepo } from "~/lib/governance/GrantRepo.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import { RbacRepo } from "~/lib/governance/RbacRepo.server"
import { ApplicationRepo } from "~/lib/governance/ApplicationRepo.server"
import { ConnectedSystemRepo } from "~/lib/governance/ConnectedSystemRepo.server"
import { ConnectorMappingRepo } from "~/lib/governance/ConnectorMappingRepo.server"
import { LldapClient } from "~/lib/services/LldapClient.server"
import { AuditService } from "~/lib/governance/AuditService.server"

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

export class PluginHost extends Context.Tag("PluginHost")<
  PluginHost,
  {
    readonly runProvision: (pluginSlug: string, grantId: string) => Effect.Effect<void, PluginHostError>
    readonly runDeprovision: (pluginSlug: string, grantId: string) => Effect.Effect<void, PluginHostError>
  }
>() {}

// ---------------------------------------------------------------------------
// Live layer — captures all dependencies at build time
// ---------------------------------------------------------------------------

export const PluginHostLive = Layer.effect(
  PluginHost,
  Effect.gen(function* () {
    const registry = yield* PluginRegistry
    const grantRepo = yield* GrantRepo
    const principalRepo = yield* PrincipalRepo
    const rbac = yield* RbacRepo
    const appRepo = yield* ApplicationRepo
    const connectedSystems = yield* ConnectedSystemRepo
    const connectorMappings = yield* ConnectorMappingRepo
    const lldap = yield* LldapClient
    const audit = yield* AuditService

    const loadGrantContext = (grantId: string) =>
      Effect.gen(function* () {
        const grant = yield* grantRepo.findById(grantId)
        if (!grant) return yield* new PluginHostError({ pluginSlug: "", grantId, message: `Grant ${grantId} not found` })
        if (!grant.roleId) return yield* new PluginHostError({ pluginSlug: "", grantId, message: "Only role grants are supported by the plugin host" })

        const principal = yield* principalRepo.findById(grant.principalId)
        if (!principal) return yield* new PluginHostError({ pluginSlug: "", grantId, message: `Principal ${grant.principalId} not found` })

        const role = yield* rbac.findRoleById(grant.roleId)
        if (!role) return yield* new PluginHostError({ pluginSlug: "", grantId, message: `Role ${grant.roleId} not found` })

        const app = yield* appRepo.findById(role.applicationId)
        if (!app) return yield* new PluginHostError({ pluginSlug: "", grantId, message: `Application ${role.applicationId} not found` })

        const system = yield* connectedSystems.findByApplicationAndType(role.applicationId, "plugin")
        if (!system) return yield* new PluginHostError({ pluginSlug: "", grantId, message: `No plugin ConnectedSystem for application ${role.applicationId}` })

        const config: Record<string, unknown> =
          typeof system.config === "string"
            ? (JSON.parse(system.config) as Record<string, unknown>)
            : ((system.config ?? {}) as Record<string, unknown>)

        return {
          grant,
          role,
          principal,
          applicationId: role.applicationId,
          applicationSlug: app.slug,
          config,
        } satisfies GrantContext
      }).pipe(Effect.mapError((e) => (e instanceof PluginHostError ? e : new PluginHostError({ pluginSlug: "", message: `Failed to load grant context: ${e}`, cause: e }))))

    const buildServices = (pluginSlug: string, manifest: PluginManifest, config: Record<string, unknown>): PluginServices => {
      const scopedVault = makeScopedVaultClient(manifest)
      return {
      lldap: makeScopedLldapClient(lldap, manifest, config),
      http: makeScopedHttpClient(manifest, scopedVault),
      vault: scopedVault,
      audit: makeScopedAuditService(audit, manifest),
      log: (message, annotations) =>
        Effect.log(message).pipe(
          Effect.annotateLogs({ ...annotations, plugin: pluginSlug }),
        ),
    }
    }

    return {
      runProvision: (pluginSlug, grantId) =>
        Effect.gen(function* () {
          const plugin = yield* registry.get(pluginSlug).pipe(
            Effect.mapError((e) => new PluginHostError({ pluginSlug, grantId, message: `Plugin not found: ${pluginSlug}`, cause: e })),
          )
          const ctx = yield* loadGrantContext(grantId)
          const { manifest } = plugin

          // Validate config against schema
          yield* Effect.try({
            try: () => Schema.decodeUnknownSync(manifest.configSchema)(ctx.config),
            catch: (e) => new PluginHostError({ pluginSlug, grantId, message: `Config validation failed: ${e}`, cause: e }),
          })

          const svc = buildServices(pluginSlug, manifest, ctx.config)

          // Audit: invoked
          yield* audit.emit({
            eventType: "plugin.action.invoked",
            targetType: "grant",
            targetId: grantId,
            applicationId: ctx.applicationId,
            metadata: { plugin: pluginSlug, operation: "provision", roleSlug: ctx.role.slug, principalId: ctx.principal.id },
          }).pipe(Effect.catchAll(() => Effect.void))

          // Dispatch: declarative or imperative
          const work =
            manifest.imperative && plugin.provision
              ? plugin.provision(ctx, svc)
              : applyPermissionStrategy(
                  manifest.permissionStrategy.byRoleSlug[ctx.role.slug] ?? [],
                  ctx,
                  svc,
                )

          // Timeout + audit envelope
          yield* work.pipe(
            Effect.timeout(Duration.millis(manifest.timeoutMs)),
            Effect.mapError((e) => new PluginHostError({ pluginSlug, grantId, message: e instanceof Error ? e.message : String(e), cause: e })),
            Effect.onExit((exit) =>
              audit
                .emit({
                  eventType: Exit.isSuccess(exit) ? "plugin.action.completed" : "plugin.action.failed",
                  targetType: "grant",
                  targetId: grantId,
                  applicationId: ctx.applicationId,
                  metadata: {
                    plugin: pluginSlug,
                    operation: "provision",
                    ...(Exit.isFailure(exit) ? { cause: Cause.pretty(exit.cause) } : {}),
                  },
                })
                .pipe(Effect.catchAll(() => Effect.void)),
            ),
          )
        }),

      runDeprovision: (pluginSlug, grantId) =>
        Effect.gen(function* () {
          const plugin = yield* registry.get(pluginSlug).pipe(
            Effect.mapError((e) => new PluginHostError({ pluginSlug, grantId, message: `Plugin not found: ${pluginSlug}`, cause: e })),
          )
          const ctx = yield* loadGrantContext(grantId)
          const { manifest } = plugin

          yield* Effect.try({
            try: () => Schema.decodeUnknownSync(manifest.configSchema)(ctx.config),
            catch: (e) => new PluginHostError({ pluginSlug, grantId, message: `Config validation failed: ${e}`, cause: e }),
          })

          // Over-revoke safety check (invariant 1): before running the
          // plugin's deprovision, check if ANY other active grant for the
          // same principal maps to the same external identifier for this app.
          // If so, skip — the user should remain in the target group.
          const system = yield* connectedSystems
            .findByApplicationAndType(ctx.applicationId, "plugin")
            .pipe(Effect.mapError((e) => new PluginHostError({ pluginSlug, grantId, message: `Failed to load connected system`, cause: e })))

          const mapping = system
            ? yield* connectorMappings
                .findByConnectedSystemAndRole(system.id, ctx.role.id)
                .pipe(Effect.mapError((e) => new PluginHostError({ pluginSlug, grantId, message: `Failed to load mapping`, cause: e })))
            : null

          if (mapping) {
            const hasOther = yield* grantRepo
              .hasOtherActiveMappingTo({
                excludeGrantId: grantId,
                principalId: ctx.principal.id,
                connectedSystemId: mapping.connectedSystemId,
                externalRoleIdentifier: mapping.externalRoleIdentifier,
              })
              .pipe(Effect.mapError((e) => new PluginHostError({ pluginSlug, grantId, message: `Over-revoke check failed`, cause: e })))

            if (hasOther) {
              yield* audit
                .emit({
                  eventType: "plugin.action.skipped",
                  targetType: "grant",
                  targetId: grantId,
                  applicationId: ctx.applicationId,
                  metadata: { plugin: pluginSlug, operation: "deprovision", reason: "other_active_grant_maps_to_same_target" },
                })
                .pipe(Effect.catchAll(() => Effect.void))
              return
            }
          }

          const svc = buildServices(pluginSlug, manifest, ctx.config)

          yield* audit.emit({
            eventType: "plugin.action.invoked",
            targetType: "grant",
            targetId: grantId,
            applicationId: ctx.applicationId,
            metadata: { plugin: pluginSlug, operation: "deprovision", roleSlug: ctx.role.slug, principalId: ctx.principal.id },
          }).pipe(Effect.catchAll(() => Effect.void))

          const work =
            manifest.imperative && plugin.deprovision
              ? plugin.deprovision(ctx, svc)
              : reversePermissionStrategy(
                  manifest.permissionStrategy.byRoleSlug[ctx.role.slug] ?? [],
                  ctx,
                  svc,
                )

          yield* work.pipe(
            Effect.timeout(Duration.millis(manifest.timeoutMs)),
            Effect.mapError((e) => new PluginHostError({ pluginSlug, grantId, message: e instanceof Error ? e.message : String(e), cause: e })),
            Effect.onExit((exit) =>
              audit
                .emit({
                  eventType: Exit.isSuccess(exit) ? "plugin.action.completed" : "plugin.action.failed",
                  targetType: "grant",
                  targetId: grantId,
                  applicationId: ctx.applicationId,
                  metadata: {
                    plugin: pluginSlug,
                    operation: "deprovision",
                    ...(Exit.isFailure(exit) ? { cause: Cause.pretty(exit.cause) } : {}),
                  },
                })
                .pipe(Effect.catchAll(() => Effect.void)),
            ),
          )
        }),
    }
  }),
)
