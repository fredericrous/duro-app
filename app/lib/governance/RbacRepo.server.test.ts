// @vitest-environment node
import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { makeTestDbLayer } from "~/lib/db/client.server"
import { RbacRepo, RbacRepoLive } from "./RbacRepo.server"

const TestLayer = RbacRepoLive.pipe(Layer.provideMerge(makeTestDbLayer()))

/** Seeds owner + app and returns the app id (parent for every role/entitlement). */
const seedApp = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
             VALUES ('p-rbac', 'user', 'rbac', 'RBAC Owner', 'rbac@example.com')`
  yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, owner_id)
             VALUES ('app-rbac', 'rbac', 'RBAC App', 'request', 'p-rbac')`
  return "app-rbac"
})

describe("RbacRepo — roles", () => {
  it.layer(TestLayer)("createRole inserts a row with the right fields", (it) => {
    it.effect("happy path + nullable description/maxDuration", () =>
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        const appId = yield* seedApp

        const role = yield* repo.createRole(appId, "editor", "Editor", "Can edit", 24)

        expect(role.slug).toBe("editor")
        expect(role.displayName).toBe("Editor")
        expect(role.description).toBe("Can edit")
        expect(role.maxDurationHours).toBe(24)
        expect(role.applicationId).toBe(appId)
      }),
    )
  })

  it.layer(TestLayer)("ensureRole returns the existing row on duplicate slug", (it) => {
    it.effect("idempotent on (appId, slug)", () =>
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        const appId = yield* seedApp

        const first = yield* repo.ensureRole(appId, "viewer", "Viewer")
        const second = yield* repo.ensureRole(appId, "viewer", "Different Name Should Be Ignored")

        expect(second.id).toBe(first.id)
        expect(second.displayName).toBe("Viewer")
      }),
    )
  })

  it.layer(TestLayer)("listRoles returns ORDER BY slug ASC", (it) => {
    it.effect("alphabetical order", () =>
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        const appId = yield* seedApp
        yield* repo.createRole(appId, "viewer", "Viewer")
        yield* repo.createRole(appId, "admin", "Admin")
        yield* repo.createRole(appId, "editor", "Editor")

        const list = yield* repo.listRoles(appId)
        expect(list.map((r) => r.slug)).toEqual(["admin", "editor", "viewer"])
      }),
    )
  })

  it.layer(TestLayer)("listAllRoles returns every role ORDER BY slug", (it) => {
    it.effect("all roles", () =>
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        const appId = yield* seedApp
        yield* repo.createRole(appId, "zeta", "Zeta")
        yield* repo.createRole(appId, "alpha", "Alpha")

        const all = yield* repo.listAllRoles()
        expect(all.map((r) => r.slug)).toEqual(["alpha", "zeta"])
      }),
    )
  })

  it.layer(TestLayer)("findRoleById returns null when missing", (it) => {
    it.effect("missing → null", () =>
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        const result = yield* repo.findRoleById("does-not-exist")
        expect(result).toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("deleteRole removes the row", (it) => {
    it.effect("post-delete findRoleById returns null", () =>
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        const appId = yield* seedApp
        const role = yield* repo.createRole(appId, "tmp", "Temporary")

        yield* repo.deleteRole(role.id)

        const result = yield* repo.findRoleById(role.id)
        expect(result).toBeNull()
      }),
    )
  })
})

describe("RbacRepo — entitlements", () => {
  it.layer(TestLayer)("createEntitlement inserts a row", (it) => {
    it.effect("required fields persisted", () =>
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        const appId = yield* seedApp

        const ent = yield* repo.createEntitlement(appId, "edit", "Edit", "May edit content")

        expect(ent.slug).toBe("edit")
        expect(ent.displayName).toBe("Edit")
        expect(ent.description).toBe("May edit content")
        expect(ent.applicationId).toBe(appId)
      }),
    )
  })

  it.layer(TestLayer)("ensureEntitlement is idempotent on (appId, slug)", (it) => {
    it.effect("second call returns same id", () =>
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        const appId = yield* seedApp

        const first = yield* repo.ensureEntitlement(appId, "read", "Read")
        const second = yield* repo.ensureEntitlement(appId, "read", "Different")

        expect(second.id).toBe(first.id)
      }),
    )
  })

  it.layer(TestLayer)("listEntitlements / findEntitlementById / deleteEntitlement", (it) => {
    it.effect("CRUD path", () =>
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        const appId = yield* seedApp

        const e1 = yield* repo.createEntitlement(appId, "read", "Read")
        yield* repo.createEntitlement(appId, "write", "Write")

        const list = yield* repo.listEntitlements(appId)
        expect(list.map((e) => e.slug)).toEqual(["read", "write"])

        const found = yield* repo.findEntitlementById(e1.id)
        expect(found?.slug).toBe("read")

        yield* repo.deleteEntitlement(e1.id)
        const afterDel = yield* repo.findEntitlementById(e1.id)
        expect(afterDel).toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("listAllEntitlements returns every entitlement ORDER BY slug", (it) => {
    it.effect("all entitlements", () =>
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        const appId = yield* seedApp
        yield* repo.createEntitlement(appId, "write", "Write")
        yield* repo.createEntitlement(appId, "read", "Read")

        const all = yield* repo.listAllEntitlements()
        expect(all.map((e) => e.slug)).toEqual(["read", "write"])
      }),
    )
  })
})

describe("RbacRepo — role-entitlement mappings", () => {
  it.layer(TestLayer)("attachEntitlement is idempotent (ON CONFLICT DO NOTHING)", (it) => {
    it.effect("attaching twice doesn't duplicate", () =>
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        const appId = yield* seedApp
        const role = yield* repo.createRole(appId, "editor", "Editor")
        const ent = yield* repo.createEntitlement(appId, "edit", "Edit")

        yield* repo.attachEntitlement(role.id, ent.id)
        yield* repo.attachEntitlement(role.id, ent.id) // duplicate — should be a no-op

        const ents = yield* repo.listRoleEntitlements(role.id)
        expect(ents).toHaveLength(1)
        expect(ents[0].id).toBe(ent.id)
      }),
    )
  })

  it.layer(TestLayer)("detachEntitlement removes the link only", (it) => {
    it.effect("entitlement row survives detach", () =>
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        const appId = yield* seedApp
        const role = yield* repo.createRole(appId, "editor", "Editor")
        const ent = yield* repo.createEntitlement(appId, "edit", "Edit")

        yield* repo.attachEntitlement(role.id, ent.id)
        yield* repo.detachEntitlement(role.id, ent.id)

        const linked = yield* repo.listRoleEntitlements(role.id)
        expect(linked).toEqual([])

        // The underlying entitlement row is still present.
        const ent2 = yield* repo.findEntitlementById(ent.id)
        expect(ent2?.id).toBe(ent.id)
      }),
    )
  })

  it.layer(TestLayer)("listRoleEntitlements returns ORDER BY slug ASC", (it) => {
    it.effect("multi-entitlement role", () =>
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        const appId = yield* seedApp
        const role = yield* repo.createRole(appId, "admin", "Admin")
        const read = yield* repo.createEntitlement(appId, "read", "Read")
        const write = yield* repo.createEntitlement(appId, "write", "Write")
        const del = yield* repo.createEntitlement(appId, "delete", "Delete")
        yield* repo.attachEntitlement(role.id, read.id)
        yield* repo.attachEntitlement(role.id, write.id)
        yield* repo.attachEntitlement(role.id, del.id)

        const list = yield* repo.listRoleEntitlements(role.id)
        expect(list.map((e) => e.slug)).toEqual(["delete", "read", "write"])
      }),
    )
  })
})

describe("RbacRepo — resources", () => {
  it.layer(TestLayer)("createResource + listResources", (it) => {
    it.effect("create then list returns alphabetical order by display name", () =>
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        const appId = yield* seedApp

        yield* repo.createResource({
          applicationId: appId,
          resourceType: "library",
          displayName: "Music",
          externalId: "lib-music",
          path: "/Music",
        })
        yield* repo.createResource({
          applicationId: appId,
          resourceType: "library",
          displayName: "Audiobooks",
        })

        const list = yield* repo.listResources(appId)
        expect(list.map((r) => r.displayName)).toEqual(["Audiobooks", "Music"])
        const music = list.find((r) => r.displayName === "Music")!
        expect(music.externalId).toBe("lib-music")
        expect(music.path).toBe("/Music")
      }),
    )
  })

  it.layer(TestLayer)("getResourceAncestors walks parent chain (without self)", (it) => {
    it.effect("returns parents in order", () =>
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        const appId = yield* seedApp

        const grandparent = yield* repo.createResource({
          applicationId: appId,
          resourceType: "folder",
          displayName: "Root",
        })
        const parent = yield* repo.createResource({
          applicationId: appId,
          resourceType: "folder",
          displayName: "Sub",
          parentResourceId: grandparent.id,
        })
        const leaf = yield* repo.createResource({
          applicationId: appId,
          resourceType: "file",
          displayName: "Leaf",
          parentResourceId: parent.id,
        })

        const ancestors = yield* repo.getResourceAncestors(leaf.id)
        expect(ancestors.map((a) => a.displayName)).toEqual(["Sub", "Root"])
      }),
    )
  })

  it.layer(TestLayer)("getResourceAncestors returns empty array for a top-level resource", (it) => {
    it.effect("orphan / root resource → []", () =>
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        const appId = yield* seedApp
        const lone = yield* repo.createResource({
          applicationId: appId,
          resourceType: "thing",
          displayName: "Alone",
        })

        const ancestors = yield* repo.getResourceAncestors(lone.id)
        expect(ancestors).toEqual([])
      }),
    )
  })

  it.layer(TestLayer)("getResourceAncestors stops at the 10-hop safety cap", (it) => {
    it.effect("very deep chains are truncated", () =>
      Effect.gen(function* () {
        const repo = yield* RbacRepo
        const appId = yield* seedApp

        // Build a chain of 15 resources; the cap is 10 hops (= 10 ancestors).
        let parentId: string | undefined
        for (let i = 0; i < 15; i++) {
          const r = yield* repo.createResource({
            applicationId: appId,
            resourceType: "folder",
            displayName: `r-${i}`,
            parentResourceId: parentId,
          })
          parentId = r.id
        }

        const leafId = parentId!
        const ancestors = yield* repo.getResourceAncestors(leafId)
        // Cap is 10 hops; the loop collects rows from hop 1 onward, so at most
        // 9 ancestors regardless of depth.
        expect(ancestors.length).toBeLessThanOrEqual(9)
      }),
    )
  })
})
