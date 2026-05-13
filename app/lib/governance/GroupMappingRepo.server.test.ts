// @vitest-environment node
import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { makeTestDbLayer } from "~/lib/db/client.server"
import { GroupMappingRepo, GroupMappingRepoLive } from "./GroupMappingRepo.server"

const TestLayer = GroupMappingRepoLive.pipe(Layer.provideMerge(makeTestDbLayer()))

/** Seeds principal + group + app + role so all FK references resolve. */
const seedRefs = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
             VALUES ('p-gm', 'user', 'gm', 'GM', 'gm@example.com')`
  yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
             VALUES ('grp-eng', 'group', 'eng', 'Engineering', NULL)`
  yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, owner_id)
             VALUES ('app-gm', 'gm', 'GM App', 'request', 'p-gm')`
  yield* sql`INSERT INTO roles (id, application_id, slug, display_name)
             VALUES ('role-gm', 'app-gm', 'editor', 'Editor')`
  return { groupId: "grp-eng", roleId: "role-gm", appId: "app-gm" }
})

describe("GroupMappingRepo", () => {
  it.layer(TestLayer)("create stores a mapping to a principal group", (it) => {
    it.effect("oidc → group", () =>
      Effect.gen(function* () {
        const repo = yield* GroupMappingRepo
        const { groupId } = yield* seedRefs

        const mapping = yield* repo.create({
          oidcGroupName: "okta-engineers",
          principalGroupId: groupId,
        })

        expect(mapping.oidcGroupName).toBe("okta-engineers")
        expect(mapping.principalGroupId).toBe(groupId)
        expect(mapping.roleId).toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("create can store a role-only mapping", (it) => {
    it.effect("oidc → role on app", () =>
      Effect.gen(function* () {
        const repo = yield* GroupMappingRepo
        const { roleId, appId } = yield* seedRefs

        const mapping = yield* repo.create({
          oidcGroupName: "okta-editors",
          roleId,
          applicationId: appId,
        })

        expect(mapping.roleId).toBe(roleId)
        expect(mapping.applicationId).toBe(appId)
        expect(mapping.principalGroupId).toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("list returns mappings with joined display names", (it) => {
    it.effect("joins surface principalGroupName / roleName / applicationName", () =>
      Effect.gen(function* () {
        const repo = yield* GroupMappingRepo
        const { groupId, roleId, appId } = yield* seedRefs

        yield* repo.create({
          oidcGroupName: "okta-engineers",
          principalGroupId: groupId,
        })
        yield* repo.create({
          oidcGroupName: "okta-editors",
          roleId,
          applicationId: appId,
        })

        const list = yield* repo.list()
        expect(list).toHaveLength(2)

        const groupMapping = list.find((m) => m.oidcGroupName === "okta-engineers")!
        expect(groupMapping.principalGroupName).toBe("Engineering")
        expect(groupMapping.roleName).toBeNull()

        const roleMapping = list.find((m) => m.oidcGroupName === "okta-editors")!
        expect(roleMapping.roleName).toBe("Editor")
        expect(roleMapping.applicationName).toBe("GM App")
      }),
    )
  })

  it.layer(TestLayer)("list returns an empty array when no mappings exist", (it) => {
    it.effect("zero rows", () =>
      Effect.gen(function* () {
        const repo = yield* GroupMappingRepo
        const list = yield* repo.list()
        expect(list).toEqual([])
      }),
    )
  })

  it.layer(TestLayer)("remove deletes the row", (it) => {
    it.effect("after remove the row no longer appears in list", () =>
      Effect.gen(function* () {
        const repo = yield* GroupMappingRepo
        const { groupId } = yield* seedRefs
        const created = yield* repo.create({
          oidcGroupName: "okta-x",
          principalGroupId: groupId,
        })

        yield* repo.remove(created.id)

        const list = yield* repo.list()
        expect(list).toEqual([])
      }),
    )
  })

  it.layer(TestLayer)("remove with a missing id resolves silently", (it) => {
    it.effect("no error on missing id", () =>
      Effect.gen(function* () {
        const repo = yield* GroupMappingRepo
        yield* repo.remove("does-not-exist")
        // Reach here without error
        expect(true).toBe(true)
      }),
    )
  })
})
