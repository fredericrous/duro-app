import { Effect } from "effect"
import type { Plugin, GrantContext, PluginServices } from "../../contracts"
import { PluginError } from "../../errors"
import { manifest, type ImmichAdminConfig } from "./manifest"

interface ImmichUser {
  id: string
  email: string
  isAdmin: boolean
}

const AUTH_OPTS = { secret: "api-key" as const, authHeader: "x-api-key" as const }

const findImmichUserByEmail = (svc: PluginServices, config: ImmichAdminConfig, email: string) =>
  Effect.gen(function* () {
    const usersRaw = yield* svc.http.get(`${config.immichUrl}/api/users`, AUTH_OPTS)
    const users = usersRaw as ImmichUser[]
    return users.find((u) => u.email === email) ?? null
  })

const provision = (ctx: GrantContext, svc: PluginServices) =>
  Effect.gen(function* () {
    if (ctx.role.slug !== "admin") {
      yield* svc.log("immich-admin-bit: non-admin role, no-op")
      return
    }

    const config = ctx.config as ImmichAdminConfig

    if (!ctx.principal.email) {
      return yield* new PluginError({
        message: `Principal ${ctx.principal.id} has no email — Immich matches users by email`,
      })
    }

    const user = yield* findImmichUserByEmail(svc, config, ctx.principal.email)
    if (!user) {
      return yield* new PluginError({
        message: `Immich user with email '${ctx.principal.email}' not found. The user must log in via OIDC at least once before admin can be granted.`,
      })
    }

    if (user.isAdmin) {
      yield* svc.log("immich-admin-bit: user is already admin, no-op", { immichUserId: user.id })
      return
    }

    yield* svc.http.put(`${config.immichUrl}/api/users/${user.id}`, { isAdmin: true }, AUTH_OPTS)

    yield* svc.log("immich-admin-bit: promoted to admin", {
      immichUserId: user.id,
      email: ctx.principal.email,
    })
  })

const deprovision = (ctx: GrantContext, svc: PluginServices) =>
  Effect.gen(function* () {
    if (ctx.role.slug !== "admin") return

    const config = ctx.config as ImmichAdminConfig

    if (!ctx.principal.email) {
      return yield* new PluginError({
        message: `Principal ${ctx.principal.id} has no email`,
      })
    }

    const user = yield* findImmichUserByEmail(svc, config, ctx.principal.email)
    if (!user) {
      yield* svc.log("immich-admin-bit: user not found in Immich, skipping deprovision")
      return
    }

    if (!user.isAdmin) {
      yield* svc.log("immich-admin-bit: user is not admin, no-op")
      return
    }

    yield* svc.http.put(`${config.immichUrl}/api/users/${user.id}`, { isAdmin: false }, AUTH_OPTS)

    yield* svc.log("immich-admin-bit: demoted from admin", {
      immichUserId: user.id,
      email: ctx.principal.email,
    })
  })

export const immichAdminBitPlugin: Plugin = {
  manifest,
  provision,
  deprovision,
}
