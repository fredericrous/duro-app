import { Effect } from "effect"
import type { PluginAction, GrantContext, PluginServices } from "./contracts"
import { reverseAction } from "./contracts"
import { PluginError } from "./errors"
import { resolveTemplate, resolveTemplateObject } from "./template"

/**
 * Walk a list of declarative actions and execute them against scoped services.
 * Used by the host for non-imperative plugins.
 */
export const applyPermissionStrategy = (
  actions: ReadonlyArray<PluginAction>,
  ctx: GrantContext,
  svc: PluginServices,
): Effect.Effect<void, PluginError> =>
  Effect.gen(function* () {
    for (const action of actions) {
      yield* dispatchAction(action, ctx, svc)
    }
  })

/**
 * Apply the REVERSE of a permission strategy's actions for deprovision.
 * Only reversible ops are flipped; non-reversible ops are skipped (the
 * plugin host rejects non-imperative plugins that use non-reversible ops
 * at startup, so this should never encounter them).
 */
export const reversePermissionStrategy = (
  actions: ReadonlyArray<PluginAction>,
  ctx: GrantContext,
  svc: PluginServices,
): Effect.Effect<void, PluginError> =>
  Effect.gen(function* () {
    for (const action of actions) {
      if (!action.reversible) continue
      yield* dispatchAction(reverseAction(action), ctx, svc)
    }
  })

const dispatchAction = (
  action: PluginAction,
  ctx: GrantContext,
  svc: PluginServices,
): Effect.Effect<void, PluginError> => {
  switch (action.op) {
    case "lldap.addGroupMember": {
      const group = resolveTemplate(action.group, ctx)
      const user = resolveTemplate(action.user, ctx)
      return svc.lldap
        .addUserToGroup(user, group)
        .pipe(
          Effect.mapError((e) => new PluginError({ message: `lldap.addGroupMember failed: ${e.message}`, cause: e })),
        )
    }
    case "lldap.removeGroupMember": {
      const group = resolveTemplate(action.group, ctx)
      const user = resolveTemplate(action.user, ctx)
      return svc.lldap
        .removeUserFromGroup(user, group)
        .pipe(
          Effect.mapError(
            (e) => new PluginError({ message: `lldap.removeGroupMember failed: ${e.message}`, cause: e }),
          ),
        )
    }
    case "http.get": {
      const url = resolveTemplate(action.url, ctx)
      return svc.http.get(url, { secret: action.secret }).pipe(Effect.asVoid)
    }
    case "http.post": {
      const url = resolveTemplate(action.url, ctx)
      const body = resolveTemplateObject(action.body, ctx)
      return svc.http.post(url, body, { secret: action.secret }).pipe(Effect.asVoid)
    }
    case "http.put": {
      const url = resolveTemplate(action.url, ctx)
      const body = resolveTemplateObject(action.body, ctx)
      return svc.http.put(url, body, { secret: action.secret }).pipe(Effect.asVoid)
    }
    case "http.delete": {
      const url = resolveTemplate(action.url, ctx)
      return svc.http.del(url, { secret: action.secret })
    }
  }
}
