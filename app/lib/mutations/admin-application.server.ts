import { Effect, Either, Schema } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { decodeForm, FormNonEmptyText, FormOptionalText, normalizeDateInput } from "~/lib/form.server"
import { ApplicationRepo } from "~/lib/governance/ApplicationRepo.server"
import { RbacRepo } from "~/lib/governance/RbacRepo.server"
import { GrantRepo } from "~/lib/governance/GrantRepo.server"
import { AppSyncService } from "~/lib/governance/AppSyncService.server"
import { AuditService } from "~/lib/governance/AuditService.server"
import { AccessMode, type Principal } from "~/lib/governance/types"
import { activateGrant } from "~/lib/workflows/grant-activation.server"

// ---------------------------------------------------------------------------
// Mutation union (parsed at the route boundary, Schema per intent so a missing
// field maps to that intent's specific error code)
// ---------------------------------------------------------------------------

/**
 * Optional expiry field. <input type="date"> posts YYYY-MM-DD — treat as
 * midnight UTC of that day; empty/absent decodes to undefined.
 */
const ExpiresAt = Schema.optionalWith(
  Schema.transform(Schema.String, Schema.UndefinedOr(Schema.String), {
    strict: true,
    decode: (s) => {
      const t = s.trim()
      return t === "" ? undefined : normalizeDateInput(t)
    },
    encode: (s) => s ?? "",
  }),
  { default: () => undefined },
)

const CreateRoleFields = Schema.Struct({
  slug: FormNonEmptyText,
  displayName: FormNonEmptyText,
  description: FormOptionalText,
})

const UpdateSettingsFields = Schema.Struct({
  // The form posts only valid modes; an invalid/absent one decodes to
  // undefined and is simply not updated (the old code passed any string
  // through to the DB CHECK constraint → 500).
  accessMode: Schema.optionalWith(Schema.UndefinedOr(AccessMode), { default: () => undefined }),
  enabled: Schema.optionalWith(Schema.String, { default: () => "" }),
  ownerId: FormOptionalText,
})

const CreateResourceFields = Schema.Struct({
  resourceType: FormNonEmptyText,
  displayName: FormNonEmptyText,
  externalId: FormOptionalText,
  path: FormOptionalText,
})

const CreateGrantFields = Schema.Struct({
  principalId: FormNonEmptyText,
  roleId: FormNonEmptyText,
  reason: FormOptionalText,
  expiresAt: ExpiresAt,
})

export type AdminApplicationMutation =
  | ({ intent: "createRole" } & typeof CreateRoleFields.Type)
  | ({ intent: "createEntitlement" } & typeof CreateRoleFields.Type)
  | ({ intent: "updateSettings" } & typeof UpdateSettingsFields.Type)
  | ({ intent: "createResource" } & typeof CreateResourceFields.Type)
  | { intent: "syncNow" }
  | ({ intent: "createGrant" } & typeof CreateGrantFields.Type)

export type AdminApplicationParseError =
  | { error: "slug_and_name_required" }
  | { error: "invalid_settings" }
  | { error: "resource_type_and_name_required" }
  | { error: "principal_and_role_required" }
  | { error: "Unknown intent" }

export function parseAdminApplicationMutation(
  formData: FormData,
): AdminApplicationMutation | AdminApplicationParseError {
  const intent = formData.get("intent")

  const decodeAs = <A, I, T extends AdminApplicationMutation["intent"], E extends AdminApplicationParseError>(
    tag: T,
    schema: Schema.Schema<A, I>,
    onError: E,
  ): ({ intent: T } & A) | E => {
    const parsed = decodeForm(schema)(formData)
    return Either.isLeft(parsed) ? onError : { intent: tag, ...parsed.right }
  }

  switch (intent) {
    case "createRole":
      return decodeAs("createRole", CreateRoleFields, { error: "slug_and_name_required" })
    case "createEntitlement":
      return decodeAs("createEntitlement", CreateRoleFields, { error: "slug_and_name_required" })
    case "updateSettings":
      return decodeAs("updateSettings", UpdateSettingsFields, { error: "invalid_settings" })
    case "createResource":
      return decodeAs("createResource", CreateResourceFields, { error: "resource_type_and_name_required" })
    case "syncNow":
      return { intent: "syncNow" }
    case "createGrant":
      return decodeAs("createGrant", CreateGrantFields, { error: "principal_and_role_required" })
    default:
      return { error: "Unknown intent" }
  }
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export type AdminApplicationResult =
  | { success: true; message: string; total?: number; created?: number; updated?: number; disabled?: number }
  | { error: string; detail?: string }

/**
 * Handle an application-admin mutation. Infrastructure failures on the simple
 * CRUD intents propagate (the route orDies them to its error boundary, as
 * before); syncNow and createGrant map failures to result values because the
 * UI renders their outcome inline.
 */
export function handleAdminApplicationMutation(appId: string, actor: Principal, mutation: AdminApplicationMutation) {
  return Effect.gen(function* () {
    switch (mutation.intent) {
      case "createRole": {
        const repo = yield* RbacRepo
        yield* repo.createRole(appId, mutation.slug, mutation.displayName, mutation.description)
        return { success: true, message: "role_created" as const }
      }

      case "createEntitlement": {
        const repo = yield* RbacRepo
        yield* repo.createEntitlement(appId, mutation.slug, mutation.displayName, mutation.description)
        return { success: true, message: "entitlement_created" as const }
      }

      case "updateSettings": {
        const repo = yield* ApplicationRepo
        const fields: Record<string, unknown> = {}
        if (mutation.accessMode) fields.accessMode = mutation.accessMode
        fields.enabled = mutation.enabled === "true"
        if (mutation.ownerId !== undefined) fields.ownerId = mutation.ownerId
        yield* repo.update(appId, fields)
        return { success: true, message: "settings_updated" as const }
      }

      case "createResource": {
        const repo = yield* RbacRepo
        yield* repo.createResource({
          applicationId: appId,
          resourceType: mutation.resourceType,
          displayName: mutation.displayName,
          externalId: mutation.externalId,
          path: mutation.path,
        })
        return { success: true, message: "resource_created" as const }
      }

      case "syncNow": {
        return yield* Effect.gen(function* () {
          const sync = yield* AppSyncService
          return yield* sync.syncFromCluster()
        }).pipe(
          Effect.map((result) => ({
            success: true,
            message: "synced" as const,
            total: result.total,
            created: result.created,
            updated: result.updated,
            disabled: result.disabled,
          })),
          Effect.catchAll((e) =>
            Effect.succeed({ error: "sync_failed" as const, detail: e instanceof Error ? e.message : String(e) }),
          ),
        )
      }

      case "createGrant": {
        return yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const grantRepo = yield* GrantRepo
          const audit = yield* AuditService
          const grantId = yield* sql.withTransaction(
            Effect.gen(function* () {
              const grant = yield* grantRepo.grantRole({
                principalId: mutation.principalId,
                roleId: mutation.roleId,
                grantedBy: actor.id,
                reason: mutation.reason,
                expiresAt: mutation.expiresAt,
              })
              yield* audit.emit({
                eventType: "grant.created",
                actorId: actor.id,
                targetType: "grant",
                targetId: grant.id,
                applicationId: appId,
                metadata: {
                  roleId: mutation.roleId,
                  principalId: mutation.principalId,
                  reason: mutation.reason,
                  expiresAt: mutation.expiresAt,
                },
              })
              return grant.id
            }),
          )
          // After the grant + audit are committed, enqueue and fork
          // provisioning. Runs outside the transaction so the LDAP connector
          // doesn't hold the DB open during network calls.
          yield* activateGrant(grantId)
        }).pipe(
          Effect.as({ success: true, message: "grant_created" as const }),
          Effect.catchAll((e) =>
            Effect.succeed({ error: "grant_failed" as const, detail: e instanceof Error ? e.message : String(e) }),
          ),
        )
      }
    }
  })
}
