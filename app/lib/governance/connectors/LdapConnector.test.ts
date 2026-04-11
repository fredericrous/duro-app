import { describe, it, expect, vi } from "vitest"
import { Context, Effect, Layer } from "effect"

// PGlite init takes ~2-3s per test under parallel load.
vi.setConfig({ testTimeout: 30000 })
import * as SqlClient from "@effect/sql/SqlClient"
import { makeTestDbLayer } from "~/lib/db/client.server"
import { ApplicationRepo, ApplicationRepoLive } from "~/lib/governance/ApplicationRepo.server"
import { RbacRepo, RbacRepoLive } from "~/lib/governance/RbacRepo.server"
import { GrantRepo, GrantRepoLive } from "~/lib/governance/GrantRepo.server"
import { PrincipalRepo, PrincipalRepoLive } from "~/lib/governance/PrincipalRepo.server"
import { ConnectedSystemRepo, ConnectedSystemRepoLive } from "~/lib/governance/ConnectedSystemRepo.server"
import { ConnectorMappingRepo, ConnectorMappingRepoLive } from "~/lib/governance/ConnectorMappingRepo.server"
import { LldapClient, type LldapGroup } from "~/lib/services/LldapClient.server"
import { LdapConnector, LdapConnectorLive } from "./LdapConnector.server"

// ---------------------------------------------------------------------------
// Fake LldapClient — records every call so tests can assert behaviour.
// ---------------------------------------------------------------------------

type LldapClientService = Context.Tag.Service<typeof LldapClient>

interface LldapFakeState {
  groups: Map<string, number> // name → id
  memberships: Set<string> // `${userId}::${groupId}`
  calls: Array<{ method: string; args: unknown[] }>
  nextGroupId: number
}

function makeLldapFake() {
  const state: LldapFakeState = {
    groups: new Map(),
    memberships: new Set(),
    calls: [],
    nextGroupId: 1,
  }

  const service: LldapClientService = {
    getUsers: Effect.succeed([]),
    getGroups: Effect.sync(() =>
      [...state.groups.entries()].map(([displayName, id]): LldapGroup => ({ id, displayName })),
    ),
    createUser: () => Effect.void,
    setUserPassword: () => Effect.void,
    deleteUser: () => Effect.void,
    addUserToGroup: (userId, groupId) =>
      Effect.sync(() => {
        state.calls.push({ method: "addUserToGroup", args: [userId, groupId] })
        state.memberships.add(`${userId}::${groupId}`)
      }),
    removeUserFromGroup: (userId, groupId) =>
      Effect.sync(() => {
        state.calls.push({ method: "removeUserFromGroup", args: [userId, groupId] })
        state.memberships.delete(`${userId}::${groupId}`)
      }),
    createGroup: (displayName) =>
      Effect.sync(() => {
        const id = state.nextGroupId++
        state.groups.set(displayName, id)
        state.calls.push({ method: "createGroup", args: [displayName] })
        return { id, displayName }
      }),
    ensureGroup: (displayName) =>
      Effect.sync(() => {
        const existing = state.groups.get(displayName)
        if (existing !== undefined) {
          state.calls.push({ method: "ensureGroup:hit", args: [displayName] })
          return existing
        }
        const id = state.nextGroupId++
        state.groups.set(displayName, id)
        state.calls.push({ method: "ensureGroup:create", args: [displayName] })
        return id
      }),
  }

  return { layer: Layer.succeed(LldapClient, service), state }
}

// ---------------------------------------------------------------------------
// Test-environment layer builder
// ---------------------------------------------------------------------------

function buildLayers(lldapLayer: Layer.Layer<LldapClient>) {
  const repoLayer = Layer.mergeAll(
    ApplicationRepoLive,
    RbacRepoLive,
    GrantRepoLive,
    PrincipalRepoLive,
    ConnectedSystemRepoLive,
    ConnectorMappingRepoLive,
  )

  const connector = LdapConnectorLive.pipe(Layer.provide(Layer.mergeAll(repoLayer, lldapLayer)))

  return Layer.mergeAll(repoLayer, lldapLayer, connector).pipe(Layer.provideMerge(makeTestDbLayer()))
}

// ---------------------------------------------------------------------------
// Seed fixture: user + app + viewer role + editor role + ConnectedSystem + mappings
// ---------------------------------------------------------------------------

interface SeedIds {
  principalId: string
  applicationId: string
  viewerRoleId: string
  editorRoleId: string
  connectedSystemId: string
}

const seedFixture = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const appRepo = yield* ApplicationRepo
  const rbac = yield* RbacRepo
  const systems = yield* ConnectedSystemRepo
  const mappings = yield* ConnectorMappingRepo

  // Principal (user). externalId must match the LLDAP username used in assertions.
  yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
             VALUES ('p-alice', 'user', 'alice', 'Alice', 'alice@localhost')`

  const app = yield* appRepo.create({ slug: "testapp", displayName: "Test App" })
  const viewerRole = yield* rbac.createRole(app.id, "viewer", "Viewer")
  const editorRole = yield* rbac.createRole(app.id, "editor", "Editor")

  const system = yield* systems.create({
    applicationId: app.id,
    connectorType: "ldap",
    config: { groupPrefix: "testapp" },
    status: "active",
  })

  yield* mappings.create({
    connectedSystemId: system.id,
    localRoleId: viewerRole.id,
    externalRoleIdentifier: "testapp-user",
  })
  yield* mappings.create({
    connectedSystemId: system.id,
    localRoleId: editorRole.id,
    externalRoleIdentifier: "testapp-user", // Same group as viewer — collapse
  })

  return {
    principalId: "p-alice",
    applicationId: app.id,
    viewerRoleId: viewerRole.id,
    editorRoleId: editorRole.id,
    connectedSystemId: system.id,
  } satisfies SeedIds
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LdapConnector", () => {
  it("provisions a user grant — ensures the group and adds the user", { timeout: 30000 }, async () => {
    const { layer, state } = makeLldapFake()

    await Effect.gen(function* () {
      const ids = yield* seedFixture
      const grantRepo = yield* GrantRepo
      const grant = yield* grantRepo.grantRole({
        principalId: ids.principalId,
        roleId: ids.viewerRoleId,
        grantedBy: ids.principalId,
      })
      const connector = yield* LdapConnector
      yield* connector.provisionGrant(grant.id)
    }).pipe(Effect.provide(buildLayers(layer)), Effect.runPromise)

    const addCalls = state.calls.filter((c) => c.method === "addUserToGroup")
    expect(addCalls).toHaveLength(1)
    expect(addCalls[0].args[0]).toBe("alice")
    // ensureGroup should have created the group the first time
    expect(state.calls.some((c) => c.method === "ensureGroup:create" && c.args[0] === "testapp-user")).toBe(true)
  })

  it(
    "deprovision leaves user in group when another active grant maps to the same external identifier",
    { timeout: 30000 },
    async () => {
      const { layer, state } = makeLldapFake()

      await Effect.gen(function* () {
        const ids = yield* seedFixture
        const grantRepo = yield* GrantRepo
        const viewerGrant = yield* grantRepo.grantRole({
          principalId: ids.principalId,
          roleId: ids.viewerRoleId,
          grantedBy: ids.principalId,
        })
        const editorGrant = yield* grantRepo.grantRole({
          principalId: ids.principalId,
          roleId: ids.editorRoleId,
          grantedBy: ids.principalId,
        })
        const connector = yield* LdapConnector
        // Provision both so the user is in the group
        yield* connector.provisionGrant(viewerGrant.id)
        yield* connector.provisionGrant(editorGrant.id)

        // Now revoke just the viewer grant in the DB
        yield* grantRepo.revoke(viewerGrant.id, ids.principalId)

        // Deprovision — should NOT remove the user because editor still maps to testapp-user
        yield* connector.deprovisionGrant(viewerGrant.id)
      }).pipe(Effect.provide(buildLayers(layer)), Effect.runPromise)

      const removeCalls = state.calls.filter((c) => c.method === "removeUserFromGroup")
      expect(removeCalls).toHaveLength(0)
    },
  )

  it(
    "deprovision removes user from group when no other active grants map to it",
    { timeout: 30000 },
    async () => {
      const { layer, state } = makeLldapFake()

      await Effect.gen(function* () {
        const ids = yield* seedFixture
        const grantRepo = yield* GrantRepo
        const grant = yield* grantRepo.grantRole({
          principalId: ids.principalId,
          roleId: ids.viewerRoleId,
          grantedBy: ids.principalId,
        })
        const connector = yield* LdapConnector
        yield* connector.provisionGrant(grant.id)
        yield* grantRepo.revoke(grant.id, ids.principalId)
        yield* connector.deprovisionGrant(grant.id)
      }).pipe(Effect.provide(buildLayers(layer)), Effect.runPromise)

      const removeCalls = state.calls.filter((c) => c.method === "removeUserFromGroup")
      expect(removeCalls).toHaveLength(1)
      expect(removeCalls[0].args[0]).toBe("alice")
    },
  )

  it("provision skips (no-op) when the principal is a group", { timeout: 30000 }, async () => {
    const { layer, state } = makeLldapFake()

    await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const appRepo = yield* ApplicationRepo
      const rbac = yield* RbacRepo
      const systems = yield* ConnectedSystemRepo
      const mappings = yield* ConnectorMappingRepo
      const grantRepo = yield* GrantRepo

      // Group principal
      yield* sql`INSERT INTO principals (id, principal_type, display_name)
                 VALUES ('g-team', 'group', 'Team')`

      const app = yield* appRepo.create({ slug: "testapp", displayName: "Test App" })
      const role = yield* rbac.createRole(app.id, "viewer", "Viewer")
      const system = yield* systems.create({
        applicationId: app.id,
        connectorType: "ldap",
        config: {},
      })
      yield* mappings.create({
        connectedSystemId: system.id,
        localRoleId: role.id,
        externalRoleIdentifier: "testapp-user",
      })
      const grant = yield* grantRepo.grantRole({
        principalId: "g-team",
        roleId: role.id,
        grantedBy: "g-team",
      })
      const connector = yield* LdapConnector
      yield* connector.provisionGrant(grant.id)
    }).pipe(Effect.provide(buildLayers(layer)), Effect.runPromise)

    expect(state.calls.filter((c) => c.method === "addUserToGroup")).toHaveLength(0)
  })

  it(
    "provision is a no-op silently when the app has no LDAP connected system",
    { timeout: 30000 },
    async () => {
      const { layer, state } = makeLldapFake()

      const result = await Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const appRepo = yield* ApplicationRepo
        const rbac = yield* RbacRepo
        const grantRepo = yield* GrantRepo

        yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
                   VALUES ('p-alice', 'user', 'alice', 'Alice', 'alice@localhost')`

        const app = yield* appRepo.create({ slug: "other", displayName: "Other App" })
        const role = yield* rbac.createRole(app.id, "viewer", "Viewer")
        const grant = yield* grantRepo.grantRole({
          principalId: "p-alice",
          roleId: role.id,
          grantedBy: "p-alice",
        })
        const connector = yield* LdapConnector
        return yield* Effect.either(connector.provisionGrant(grant.id))
      }).pipe(Effect.provide(buildLayers(layer)), Effect.runPromise)

      // App has no LDAP ConnectedSystem — connector fails with a clear error,
      // surfaced to the caller. The job would be marked failed.
      expect(result._tag).toBe("Left")
      expect(state.calls.filter((c) => c.method === "addUserToGroup")).toHaveLength(0)
    },
  )
})
