import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { makeTestDbLayer } from "~/lib/db/client.server"
import { ConnectorMappingRepo, ConnectorMappingRepoLive } from "./ConnectorMappingRepo.server"

const TestLayer = ConnectorMappingRepoLive.pipe(Layer.provideMerge(makeTestDbLayer()))

/** Seeds owner + app + connected_system + one role; returns ids. */
const seedSystemAndRole = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
             VALUES ('p-cm', 'user', 'cm', 'CM', 'cm@example.com')`
  yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, owner_id)
             VALUES ('app-cm', 'cm', 'CM', 'request', 'p-cm')`
  const rows = yield* sql<{
    id: string
  }>`INSERT INTO connected_systems (application_id, connector_type, config, status)
     VALUES ('app-cm', 'http', '{}'::jsonb, 'active')
     RETURNING id`
  const systemId = rows[0].id
  yield* sql`INSERT INTO roles (id, application_id, slug, display_name)
             VALUES ('role-cm', 'app-cm', 'editor', 'Editor')`
  yield* sql`INSERT INTO entitlements (id, application_id, slug, display_name)
             VALUES ('ent-cm', 'app-cm', 'edit', 'Edit')`
  return { systemId, roleId: "role-cm", entitlementId: "ent-cm" }
})

describe("ConnectorMappingRepo", () => {
  it.layer(TestLayer)("create stores a role-mapped row with default direction", (it) => {
    it.effect("direction defaults to push", () =>
      Effect.gen(function* () {
        const repo = yield* ConnectorMappingRepo
        const { systemId, roleId } = yield* seedSystemAndRole

        const mapping = yield* repo.create({
          connectedSystemId: systemId,
          localRoleId: roleId,
          externalRoleIdentifier: "gitea:admins",
        })

        expect(mapping.connectedSystemId).toBe(systemId)
        expect(mapping.localRoleId).toBe(roleId)
        expect(mapping.externalRoleIdentifier).toBe("gitea:admins")
        expect(mapping.direction).toBe("push")
      }),
    )
  })

  it.layer(TestLayer)("create honors entitlement and custom direction", (it) => {
    it.effect("entitlement-mapped + bidirectional", () =>
      Effect.gen(function* () {
        const repo = yield* ConnectorMappingRepo
        const { systemId, entitlementId } = yield* seedSystemAndRole

        const mapping = yield* repo.create({
          connectedSystemId: systemId,
          localEntitlementId: entitlementId,
          externalRoleIdentifier: "gitea:write",
          direction: "bidirectional",
        })

        expect(mapping.localEntitlementId).toBe(entitlementId)
        expect(mapping.localRoleId).toBeNull()
        expect(mapping.direction).toBe("bidirectional")
      }),
    )
  })

  it.layer(TestLayer)("findByConnectedSystemAndRole returns matching row", (it) => {
    it.effect("happy path", () =>
      Effect.gen(function* () {
        const repo = yield* ConnectorMappingRepo
        const { systemId, roleId } = yield* seedSystemAndRole
        yield* repo.create({
          connectedSystemId: systemId,
          localRoleId: roleId,
          externalRoleIdentifier: "gitea:admins",
        })

        const found = yield* repo.findByConnectedSystemAndRole(systemId, roleId)
        expect(found?.externalRoleIdentifier).toBe("gitea:admins")
      }),
    )
  })

  it.layer(TestLayer)("findByConnectedSystemAndRole returns null when missing", (it) => {
    it.effect("no mapping registered", () =>
      Effect.gen(function* () {
        const repo = yield* ConnectorMappingRepo
        const { systemId, roleId } = yield* seedSystemAndRole

        const found = yield* repo.findByConnectedSystemAndRole(systemId, roleId)
        expect(found).toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("listByConnectedSystem returns every mapping for that system", (it) => {
    it.effect("filters by connectedSystemId", () =>
      Effect.gen(function* () {
        const repo = yield* ConnectorMappingRepo
        const { systemId, roleId, entitlementId } = yield* seedSystemAndRole
        yield* repo.create({
          connectedSystemId: systemId,
          localRoleId: roleId,
          externalRoleIdentifier: "ext-1",
        })
        yield* repo.create({
          connectedSystemId: systemId,
          localEntitlementId: entitlementId,
          externalRoleIdentifier: "ext-2",
        })

        const list = yield* repo.listByConnectedSystem(systemId)
        expect(list).toHaveLength(2)
        expect(list.map((m) => m.externalRoleIdentifier).sort()).toEqual(["ext-1", "ext-2"])
      }),
    )
  })

  it.layer(TestLayer)("ensureForRole is idempotent — returns existing if present", (it) => {
    it.effect("second call doesn't duplicate", () =>
      Effect.gen(function* () {
        const repo = yield* ConnectorMappingRepo
        const { systemId, roleId } = yield* seedSystemAndRole

        const first = yield* repo.ensureForRole({
          connectedSystemId: systemId,
          localRoleId: roleId,
          externalRoleIdentifier: "ext",
        })
        const second = yield* repo.ensureForRole({
          connectedSystemId: systemId,
          localRoleId: roleId,
          externalRoleIdentifier: "ext-different", // would be inserted, but should be ignored
        })

        // Same row, not duplicated.
        expect(second.id).toBe(first.id)
        // Original externalRoleIdentifier preserved.
        expect(second.externalRoleIdentifier).toBe("ext")

        const list = yield* repo.listByConnectedSystem(systemId)
        expect(list).toHaveLength(1)
      }),
    )
  })

  it.layer(TestLayer)("ensureForRole inserts a new row when none exists", (it) => {
    it.effect("first call performs the insert", () =>
      Effect.gen(function* () {
        const repo = yield* ConnectorMappingRepo
        const { systemId, roleId } = yield* seedSystemAndRole

        const mapping = yield* repo.ensureForRole({
          connectedSystemId: systemId,
          localRoleId: roleId,
          externalRoleIdentifier: "gitea:devs",
          direction: "pull",
        })

        expect(mapping.localRoleId).toBe(roleId)
        expect(mapping.direction).toBe("pull")
      }),
    )
  })
})
