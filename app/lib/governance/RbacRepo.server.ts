import { Context, Effect, Data, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import * as SqlError from "@effect/sql/SqlError"
import * as crypto from "node:crypto"
import { MigrationsRan } from "~/lib/db/client.server"
import { decodeRole, decodeEntitlement, decodeResource, type Role, type Entitlement, type Resource } from "./types"

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class RbacRepoError extends Data.TaggedError("RbacRepoError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

export class RbacRepo extends Context.Tag("RbacRepo")<
  RbacRepo,
  {
    // Roles
    readonly createRole: (
      appId: string,
      slug: string,
      displayName: string,
      description?: string,
      maxDurationHours?: number,
    ) => Effect.Effect<Role, RbacRepoError>
    readonly ensureRole: (
      appId: string,
      slug: string,
      displayName: string,
      description?: string,
      maxDurationHours?: number,
    ) => Effect.Effect<Role, RbacRepoError>
    readonly listRoles: (appId: string) => Effect.Effect<Role[], RbacRepoError>
    readonly findRoleById: (id: string) => Effect.Effect<Role | null, RbacRepoError>
    readonly deleteRole: (id: string) => Effect.Effect<void, RbacRepoError>

    // Entitlements
    readonly createEntitlement: (
      appId: string,
      slug: string,
      displayName: string,
      description?: string,
    ) => Effect.Effect<Entitlement, RbacRepoError>
    readonly ensureEntitlement: (
      appId: string,
      slug: string,
      displayName: string,
      description?: string,
    ) => Effect.Effect<Entitlement, RbacRepoError>
    readonly listEntitlements: (appId: string) => Effect.Effect<Entitlement[], RbacRepoError>
    readonly findEntitlementById: (id: string) => Effect.Effect<Entitlement | null, RbacRepoError>
    readonly deleteEntitlement: (id: string) => Effect.Effect<void, RbacRepoError>

    // Role-entitlement mappings
    readonly attachEntitlement: (roleId: string, entitlementId: string) => Effect.Effect<void, RbacRepoError>
    readonly detachEntitlement: (roleId: string, entitlementId: string) => Effect.Effect<void, RbacRepoError>
    readonly listRoleEntitlements: (roleId: string) => Effect.Effect<Entitlement[], RbacRepoError>

    // Resources
    readonly createResource: (input: {
      applicationId: string
      resourceType: string
      displayName: string
      parentResourceId?: string
      externalId?: string
      path?: string
    }) => Effect.Effect<Resource, RbacRepoError>
    readonly listResources: (appId: string) => Effect.Effect<Resource[], RbacRepoError>
    readonly getResourceAncestors: (resourceId: string) => Effect.Effect<Resource[], RbacRepoError>
  }
>() {}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

const withErr = <A>(effect: Effect.Effect<A, SqlError.SqlError>, message: string) =>
  effect.pipe(Effect.mapError((e) => new RbacRepoError({ message, cause: e })))

// ---------------------------------------------------------------------------
// Live layer
// ---------------------------------------------------------------------------

export const RbacRepoLive = Layer.effect(
  RbacRepo,
  Effect.gen(function* () {
    yield* MigrationsRan
    const sql = yield* SqlClient.SqlClient

    return {
      // ---- Roles ----

      createRole: (appId, slug, displayName, description?, maxDurationHours?) =>
        Effect.gen(function* () {
          const id = crypto.randomUUID()
          const rows = yield* withErr(
            sql`INSERT INTO roles (id, application_id, slug, display_name, description, max_duration_hours)
                VALUES (${id}, ${appId}, ${slug}, ${displayName}, ${description ?? null}, ${maxDurationHours ?? null})
                RETURNING *`,
            "Failed to create role",
          )
          return decodeRole(rows[0])
        }),

      ensureRole: (appId, slug, displayName, description?, maxDurationHours?) =>
        Effect.gen(function* () {
          const id = crypto.randomUUID()
          const inserted = yield* withErr(
            sql`INSERT INTO roles (id, application_id, slug, display_name, description, max_duration_hours)
                VALUES (${id}, ${appId}, ${slug}, ${displayName}, ${description ?? null}, ${maxDurationHours ?? null})
                ON CONFLICT (application_id, slug) DO NOTHING
                RETURNING *`,
            "Failed to ensure role",
          )
          if (inserted.length > 0) return decodeRole(inserted[0])
          const existing = yield* withErr(
            sql`SELECT * FROM roles WHERE application_id = ${appId} AND slug = ${slug}`,
            "Failed to look up existing role",
          )
          return decodeRole(existing[0])
        }),

      listRoles: (appId) =>
        withErr(
          sql`SELECT * FROM roles WHERE application_id = ${appId} ORDER BY slug`.pipe(
            Effect.map((rows) => rows.map((r) => decodeRole(r))),
          ),
          "Failed to list roles",
        ),

      findRoleById: (id) =>
        withErr(
          sql`SELECT * FROM roles WHERE id = ${id}`.pipe(
            Effect.map((rows) => (rows.length > 0 ? decodeRole(rows[0]) : null)),
          ),
          "Failed to find role",
        ),

      deleteRole: (id) => withErr(sql`DELETE FROM roles WHERE id = ${id}`.pipe(Effect.asVoid), "Failed to delete role"),

      // ---- Entitlements ----

      createEntitlement: (appId, slug, displayName, description?) =>
        Effect.gen(function* () {
          const id = crypto.randomUUID()
          const rows = yield* withErr(
            sql`INSERT INTO entitlements (id, application_id, slug, display_name, description)
                VALUES (${id}, ${appId}, ${slug}, ${displayName}, ${description ?? null})
                RETURNING *`,
            "Failed to create entitlement",
          )
          return decodeEntitlement(rows[0])
        }),

      ensureEntitlement: (appId, slug, displayName, description?) =>
        Effect.gen(function* () {
          const id = crypto.randomUUID()
          const inserted = yield* withErr(
            sql`INSERT INTO entitlements (id, application_id, slug, display_name, description)
                VALUES (${id}, ${appId}, ${slug}, ${displayName}, ${description ?? null})
                ON CONFLICT (application_id, slug) DO NOTHING
                RETURNING *`,
            "Failed to ensure entitlement",
          )
          if (inserted.length > 0) return decodeEntitlement(inserted[0])
          const existing = yield* withErr(
            sql`SELECT * FROM entitlements WHERE application_id = ${appId} AND slug = ${slug}`,
            "Failed to look up existing entitlement",
          )
          return decodeEntitlement(existing[0])
        }),

      listEntitlements: (appId) =>
        withErr(
          sql`SELECT * FROM entitlements WHERE application_id = ${appId} ORDER BY slug`.pipe(
            Effect.map((rows) => rows.map((r) => decodeEntitlement(r))),
          ),
          "Failed to list entitlements",
        ),

      findEntitlementById: (id) =>
        withErr(
          sql`SELECT * FROM entitlements WHERE id = ${id}`.pipe(
            Effect.map((rows) => (rows.length > 0 ? decodeEntitlement(rows[0]) : null)),
          ),
          "Failed to find entitlement",
        ),

      deleteEntitlement: (id) =>
        withErr(sql`DELETE FROM entitlements WHERE id = ${id}`.pipe(Effect.asVoid), "Failed to delete entitlement"),

      // ---- Role-entitlement mappings ----

      attachEntitlement: (roleId, entitlementId) =>
        withErr(
          sql`INSERT INTO role_entitlements (role_id, entitlement_id)
              VALUES (${roleId}, ${entitlementId})
              ON CONFLICT DO NOTHING`.pipe(Effect.asVoid),
          "Failed to attach entitlement to role",
        ),

      detachEntitlement: (roleId, entitlementId) =>
        withErr(
          sql`DELETE FROM role_entitlements
              WHERE role_id = ${roleId} AND entitlement_id = ${entitlementId}`.pipe(Effect.asVoid),
          "Failed to detach entitlement from role",
        ),

      listRoleEntitlements: (roleId) =>
        withErr(
          sql`SELECT e.* FROM entitlements e
              JOIN role_entitlements re ON re.entitlement_id = e.id
              WHERE re.role_id = ${roleId}
              ORDER BY e.slug`.pipe(Effect.map((rows) => rows.map((r) => decodeEntitlement(r)))),
          "Failed to list role entitlements",
        ),

      // ---- Resources ----

      createResource: (input) =>
        Effect.gen(function* () {
          const id = crypto.randomUUID()
          const rows = yield* withErr(
            sql`INSERT INTO resources (id, application_id, resource_type, display_name, parent_resource_id, external_id, path)
                VALUES (${id}, ${input.applicationId}, ${input.resourceType}, ${input.displayName}, ${input.parentResourceId ?? null}, ${input.externalId ?? null}, ${input.path ?? null})
                RETURNING *`,
            "Failed to create resource",
          )
          return decodeResource(rows[0])
        }),

      listResources: (appId) =>
        withErr(
          sql`SELECT * FROM resources WHERE application_id = ${appId} ORDER BY display_name`.pipe(
            Effect.map((rows) => rows.map((r) => decodeResource(r))),
          ),
          "Failed to list resources",
        ),

      getResourceAncestors: (resourceId) =>
        Effect.gen(function* () {
          const ancestors: Resource[] = []
          let currentId: string | null = resourceId

          for (let hop = 0; hop < 10 && currentId !== null; hop++) {
            const rows = yield* withErr(
              sql`SELECT * FROM resources WHERE id = ${currentId}`,
              "Failed to fetch resource ancestor",
            )
            if (rows.length === 0) break
            const resource = decodeResource(rows[0])
            // Skip the starting resource itself — only collect ancestors
            if (hop > 0) {
              ancestors.push(resource)
            }
            currentId = resource.parentResourceId
          }

          return ancestors
        }),
    }
  }),
)
